import { env } from "cloudflare:workers"
import type { WebhookQueueMessage } from "@alchemy.run"
import type { Queue } from "@cloudflare/workers-types"
import type { Address, Hash } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { logger } from "@/lib/logger"
import { WebhookRepository } from "@/repositories/webhook.repository"
import type { ActivationResult } from "@/services/subscription.service"
import {
  type OrderType,
  type SubscriptionStatus,
  type SubscriptionUpdatedEventData,
  WEBHOOK_EVENT_TYPE,
  type WebhookEvent,
} from "@/types/webhook.types"

export interface SetWebhookParams {
  accountAddress: Address
  url: string
}

export interface WebhookResult {
  url: string
  secret: string
}

/**
 * Simplified parameters for webhook events - callers just pass what they have
 */
export interface EmitWebhookEventParams {
  accountAddress: Address // From auth context
  subscriptionId: Hash
  subscriptionStatus: SubscriptionStatus
  currentPeriodEnd?: Date
  orderNumber?: number
  orderType?: OrderType
  amount?: string
  transactionHash?: Hash
  success?: boolean
  errorCode?: string
  errorMessage?: string
}

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
  async getWebhookWithSecret(accountAddress: Address) {
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
      subscriptionStatus: "active",
      currentPeriodEnd: new Date(result.nextOrder.date),
      orderNumber: result.order.number, // Use actual order number from database
      orderType: "initial",
      amount: result.transaction.amount,
      transactionHash: result.transaction.hash,
      success: true,
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
  }): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: "active",
      orderNumber: params.orderNumber,
      orderType: "recurring",
      amount: params.amount,
      transactionHash: params.transactionHash,
      success: true,
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
    failureReason?: string
  }): Promise<void> {
    await this.emitSubscriptionUpdated({
      accountAddress: params.accountAddress,
      subscriptionId: params.subscriptionId,
      subscriptionStatus: "inactive",
      orderNumber: params.orderNumber,
      orderType: "recurring",
      amount: params.amount,
      success: false,
      errorCode: "payment_failed",
      errorMessage: params.failureReason || "Payment processing failed",
    })
  }

  /**
   * Emits a webhook event for subscription updates
   * Handles all formatting internally
   */
  async emitSubscriptionUpdated(params: EmitWebhookEventParams): Promise<void> {
    const { accountAddress, subscriptionId } = params
    const log = logger.with({
      service: "webhook-event",
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

      // Format the event based on what data we have
      const eventData: SubscriptionUpdatedEventData = {
        subscription: {
          id: subscriptionId,
          status: params.subscriptionStatus,
        },
      }

      // Add current period end if provided
      if (params.currentPeriodEnd) {
        eventData.subscription.current_period_end = Math.floor(
          params.currentPeriodEnd.getTime() / 1000,
        )
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
