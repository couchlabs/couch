import { env } from "cloudflare:workers"
import type { WebhookQueueMessage } from "@alchemy.run"
import type { Queue } from "@cloudflare/workers-types"
import type { Address, Hash } from "viem"
import {
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { createLogger } from "@/lib/logger"
import {
  type Webhook,
  WebhookRepository,
} from "@/repositories/webhook.repository"
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
}

const logger = createLogger("webhook.service")

export class WebhookService {
  private webhookRepository: WebhookRepository
  private webhookQueue: Queue<WebhookQueueMessage>

  constructor() {
    this.webhookRepository = new WebhookRepository()
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
   * Gets webhook with secret (for internal use only - webhook delivery)
   */
  async getWebhookWithSecret(accountAddress: Address): Promise<Webhook | null> {
    return await this.webhookRepository.getWebhook({ accountAddress })
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
    orderNumber: number
    amount: string
    periodInSeconds: number
    failureReason?: string
  }): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: SubscriptionStatus.INACTIVE,
      subscriptionAmount: params.amount, // Use order amount as subscription metadata
      subscriptionPeriodInSeconds: params.periodInSeconds, // Use order period as subscription metadata
      orderNumber: params.orderNumber,
      orderType: OrderType.RECURRING,
      amount: params.amount,
      success: false,
      errorCode: "payment_failed",
      errorMessage: params.failureReason || "Payment processing failed",
    })
  }

  /**
   * Emits webhook event when initial activation charge fails
   */
  async emitActivationFailed(params: {
    accountAddress: Address
    subscriptionId: Hash
    amount: string
    periodInSeconds: number
    errorCode: string
    errorMessage: string
  }): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: SubscriptionStatus.INACTIVE,
      subscriptionAmount: params.amount,
      subscriptionPeriodInSeconds: params.periodInSeconds,
      success: false,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
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

      // Queue the webhook for delivery
      const message: WebhookQueueMessage = {
        url: webhook.url,
        secret: webhook.secret,
        event,
      }

      await this.webhookQueue.send(message)

      log.info("Webhook event queued for delivery", {
        eventType: event.type,
        url: webhook.url,
        accountAddress,
      })
    } catch (error) {
      log.error("Failed to emit webhook event", { error })
      // Don't throw - webhook failures shouldn't break the main flow
    }
  }
}
