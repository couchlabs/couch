import type { WebhookQueueMessage } from "@alchemy.run"
import type { Queue } from "@cloudflare/workers-types"
import type { Address, Hash } from "viem"
import {
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { getErrorMessage, isExposableError } from "@/errors/subscription.errors"
import { createLogger } from "@/lib/logger"
import { WebhookRepository } from "@/repositories/webhook.repository"
import type { ActivationResult } from "@/services/subscription.service"

/**
 * Webhook event types for v1
 * Following spec: "Single event type with domain-aligned structure"
 */
export const WEBHOOK_EVENT_TYPE = "subscription.updated" as const

/**
 * Order status in webhook events (subset of OrderStatus for external API)
 */
export type WebhookOrderStatus = "paid" | "failed"

/**
 * Subscription data in webhook event
 * These fields represent immutable subscription terms from the signed permission
 */
export interface WebhookSubscriptionData {
  id: Hash
  status: SubscriptionStatus
  amount: string // Recurring charge amount (e.g., "0.0001") - always present
  period_in_seconds: number // Billing period (e.g., 60) - always present
}

/**
 * Order data in webhook event (present if event relates to a payment)
 */
export interface WebhookOrderData {
  number: number // Sequential number relative to subscription
  type: OrderType
  amount: string
  status: WebhookOrderStatus
  current_period_start?: number // Unix timestamp
  current_period_end?: number // Unix timestamp
  next_retry_at?: number // Unix timestamp - when next payment retry is scheduled (only present when retrying)
}

/**
 * Transaction data in webhook event (present if payment was successful)
 */
export interface WebhookTransactionData {
  hash: Hash
  amount: string
  processed_at: number // Unix timestamp
}

/**
 * Error data in webhook event (present if payment failed)
 */
export interface WebhookErrorData {
  code: string
  message: string
}

/**
 * Event data structure for subscription.updated
 */
export interface SubscriptionUpdatedEventData {
  subscription: WebhookSubscriptionData
  order?: WebhookOrderData
  transaction?: WebhookTransactionData
  error?: WebhookErrorData
}

/**
 * Complete webhook event structure
 */
export interface WebhookEvent {
  type: typeof WEBHOOK_EVENT_TYPE
  created_at: number // Unix timestamp
  data: SubscriptionUpdatedEventData
}

export interface SetWebhookParams {
  accountAddress: Address
  url: string
}

export interface WebhookResult {
  url: string
  secret: string
}

/**
 * Parameters for webhook events
 * subscriptionAmount and subscriptionPeriodInSeconds are REQUIRED - they represent immutable subscription terms
 */
export interface EmitWebhookEventParams {
  accountAddress: Address // From auth context
  subscriptionId: Hash
  subscriptionStatus: SubscriptionStatus
  subscriptionAmount: string // Recurring charge amount - REQUIRED
  subscriptionPeriodInSeconds: number // Billing period - REQUIRED
  orderNumber?: number
  orderType?: OrderType
  amount?: string // Order amount (can differ from subscription amount)
  transactionHash?: Hash
  success?: boolean
  errorCode?: string
  errorMessage?: string
  orderDueAt?: Date // Order's due_at (period start)
  orderPeriodInSeconds?: number // Order's period length
  nextRetryAt?: Date // When next payment retry is scheduled (only for failed payments with retries)
}

const logger = createLogger("webhook.service")

export class WebhookService {
  private webhookRepository: WebhookRepository
  private webhookQueue: Queue<WebhookQueueMessage>

  constructor(env) {
    this.webhookRepository = new WebhookRepository(env)
    this.webhookQueue = env.WEBHOOK_QUEUE
  }

  /**
   * Generates a secure webhook secret for HMAC signing
   * Format: whsec_ prefix + 32 bytes hex (following industry standards like Stripe)
   */
  private generateWebhookSecret(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    return `whsec_${hex}`
  }

  /**
   * Validates webhook URL format and protocol
   */
  private validateWebhookUrl(url: string): void {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Invalid webhook URL format",
      )
    }

    // Require HTTPS
    if (parsed.protocol !== "https:") {
      // Commented for testing, miniflare via alchemy currently support https
      // https://developers.cloudflare.com/workers/testing/miniflare/get-started/#https-server eventually look into open a PR
      // or add support for http in case of localhost...
      // throw new HTTPError(
      //   400,
      //   ErrorCode.INVALID_FORMAT,
      //   "Webhook URL must use HTTPS",
      // )
    }
  }

  /**
   * Generates HMAC signature for webhook payload
   * Uses SHA-256 HMAC to sign the payload with the webhook secret
   */
  private async generateHMACSignature(
    secret: string,
    payload: string,
  ): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )

    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload),
    )

    // Convert to hex string
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }

  /**
   * Sets or updates the webhook URL for an account
   * Generates a new secret each time
   */
  async setWebhook(params: SetWebhookParams): Promise<WebhookResult> {
    const { accountAddress, url } = params
    const log = logger.with({ accountAddress, webhookUrl: url })

    log.info("Setting webhook URL")

    // Validate URL format
    this.validateWebhookUrl(url)

    // Generate new secret for this webhook
    const secret = this.generateWebhookSecret()

    // Create or update webhook
    await this.webhookRepository.createOrUpdateWebhook({
      accountAddress,
      url,
      secret,
    })

    log.info("Webhook URL set successfully")
    return { url, secret }
  }

  /**
   * Emits webhook event for initial subscription activation
   * Tailored for the activation flow - just pass the result!
   */
  async emitSubscriptionActivated(result: ActivationResult): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: result.accountAddress,
      subscriptionId: result.subscriptionId,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionAmount: result.transaction.amount,
      subscriptionPeriodInSeconds: result.order.periodInSeconds,
      orderNumber: result.order.number, // Use actual order number from database
      orderType: OrderType.INITIAL,
      amount: result.transaction.amount,
      transactionHash: result.transaction.hash,
      success: true,
      orderDueAt: new Date(result.order.dueAt),
      orderPeriodInSeconds: result.order.periodInSeconds,
    })
  }

  /**
   * Emits webhook event when subscription is created (before activation charge)
   * Fires with subscription metadata (amount, period)
   */
  async emitSubscriptionCreated(params: {
    accountAddress: Address
    subscriptionId: Hash
    amount: string
    periodInSeconds: number
  }): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: SubscriptionStatus.PROCESSING,
      subscriptionAmount: params.amount,
      subscriptionPeriodInSeconds: params.periodInSeconds,
    })
  }

  /**
   * Emits webhook event for successful recurring payment
   * Tailored for order processing flow
   */
  async emitPaymentProcessed(params: {
    accountAddress: Address
    subscriptionId: Hash
    orderNumber: number
    amount: string
    transactionHash: Hash
    orderDueAt: Date
    orderPeriodInSeconds: number
  }): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      subscriptionAmount: params.amount, // Use order amount as subscription metadata
      subscriptionPeriodInSeconds: params.orderPeriodInSeconds, // Use order period as subscription metadata
      orderNumber: params.orderNumber,
      orderType: OrderType.RECURRING,
      amount: params.amount,
      transactionHash: params.transactionHash,
      success: true,
      orderDueAt: params.orderDueAt,
      orderPeriodInSeconds: params.orderPeriodInSeconds,
    })
  }

  /**
   * Emits webhook event for failed recurring payment
   * Tailored for payment failure flow
   */
  async emitPaymentFailed(params: {
    accountAddress: Address
    subscriptionId: Hash
    subscriptionStatus: SubscriptionStatus // Pass correct status based on error type
    orderNumber: number
    amount: string
    periodInSeconds: number
    failureReason?: string // Error code (e.g., INSUFFICIENT_BALANCE)
    failureMessage?: string // Original SDK error message
    nextRetryAt?: Date // When next payment retry is scheduled
  }): Promise<void> {
    // Use error code, fallback to generic PAYMENT_FAILED
    const errorCode = params.failureReason || ErrorCode.PAYMENT_FAILED

    // Use original SDK message if available, otherwise use generic message
    const errorMessage =
      params.failureMessage || getErrorMessage(errorCode as ErrorCode)

    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: params.subscriptionStatus, // Use passed status
      subscriptionAmount: params.amount, // Use order amount as subscription metadata
      subscriptionPeriodInSeconds: params.periodInSeconds, // Use order period as subscription metadata
      orderNumber: params.orderNumber,
      orderType: OrderType.RECURRING,
      amount: params.amount,
      success: false,
      errorCode,
      errorMessage,
      nextRetryAt: params.nextRetryAt,
    })
  }

  /**
   * Emits webhook event when initial activation charge fails
   * Sanitizes error details based on error type (payment vs system)
   */
  async emitActivationFailed(params: {
    accountAddress: Address
    subscriptionId: Hash
    amount: string
    periodInSeconds: number
    error: unknown
  }): Promise<void> {
    // Sanitize error for webhook exposure
    // Not all errors come from provider - could be DB, validation, or webhook errors
    // Only expose payment errors (402) to merchants, hide internal errors
    let errorCode = "internal_error"
    let errorMessage = "An internal error occurred"

    if (isExposableError(params.error)) {
      // Payment errors (402) are exposed with details
      errorCode = params.error.code
      errorMessage = params.error.message
    }

    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: SubscriptionStatus.INCOMPLETE,
      subscriptionAmount: params.amount,
      subscriptionPeriodInSeconds: params.periodInSeconds,
      success: false,
      errorCode,
      errorMessage,
    })
  }

  /**
   * Emits a webhook event for subscription updates
   * Handles all formatting internally
   */
  async emitSubscriptionUpdated(params: EmitWebhookEventParams): Promise<void> {
    const { accountAddress, subscriptionId } = params
    const log = logger.with({
      accountAddress,
      subscriptionId,
    })

    try {
      // Get webhook configuration for this account
      const webhook = await this.webhookRepository.getWebhook({
        accountAddress,
      })

      if (!webhook) {
        return
      }

      const timestamp = Math.floor(Date.now() / 1000)

      // Format the event - subscription metadata is always present
      const eventData: SubscriptionUpdatedEventData = {
        subscription: {
          id: subscriptionId,
          status: params.subscriptionStatus,
          amount: params.subscriptionAmount,
          period_in_seconds: params.subscriptionPeriodInSeconds,
        },
      }

      // Add order data if we have payment info
      if (
        params.orderNumber &&
        params.orderType &&
        params.amount !== undefined
      ) {
        eventData.order = {
          number: params.orderNumber,
          type: params.orderType,
          amount: params.amount,
          status: params.success ? "paid" : "failed",
        }

        // Calculate and add period timestamps from due_at + period_in_seconds
        // TODO abstract such thing into helper function
        if (params.orderDueAt && params.orderPeriodInSeconds) {
          const periodStartTimestamp = Math.floor(
            params.orderDueAt.getTime() / 1000,
          )
          const periodEndTimestamp =
            periodStartTimestamp + params.orderPeriodInSeconds

          eventData.order.current_period_start = periodStartTimestamp
          eventData.order.current_period_end = periodEndTimestamp
        }

        // Add next retry timestamp if scheduled (only for failed payments with retries)
        if (params.nextRetryAt) {
          eventData.order.next_retry_at = Math.floor(
            params.nextRetryAt.getTime() / 1000,
          )
        }
      }

      // Add transaction data if payment was successful
      if (params.success && params.transactionHash && params.amount) {
        eventData.transaction = {
          hash: params.transactionHash,
          amount: params.amount,
          processed_at: timestamp,
        }
      }

      // Add error data if payment failed
      if (!params.success && params.errorCode) {
        eventData.error = {
          code: params.errorCode,
          message: params.errorMessage || "Payment processing failed",
        }
      }

      // Create the event
      const event: WebhookEvent = {
        type: WEBHOOK_EVENT_TYPE,
        created_at: timestamp,
        data: eventData,
      }

      // Pre-serialize and sign the webhook payload
      const payload = JSON.stringify(event)
      const signature = await this.generateHMACSignature(
        webhook.secret,
        payload,
      )

      // Queue the pre-signed webhook for delivery
      const message: WebhookQueueMessage = {
        url: webhook.url,
        payload,
        signature,
        timestamp: event.created_at,
      }

      await this.webhookQueue.send(message)

      log.info("Webhook event queued for delivery (pre-signed)", {
        eventType: event.type,
        url: webhook.url,
        accountAddress,
        signaturePreview: `${signature.slice(0, 8)}...`,
      })
    } catch (error) {
      log.error("Failed to emit webhook event", { error })
      // Don't throw - webhook failures shouldn't break the main flow
    }
  }
}
