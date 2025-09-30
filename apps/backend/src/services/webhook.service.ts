import type { Address } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { logger } from "@/lib/logger"
import type { WebhookRepository } from "@/repositories/webhook.repository"

export interface SetWebhookParams {
  accountAddress: Address
  url: string
}

export interface WebhookResult {
  url: string
  secret: string
}

export class WebhookService {
  private webhookRepository: WebhookRepository

  constructor(deps: { webhookRepository: WebhookRepository }) {
    this.webhookRepository = deps.webhookRepository
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
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Webhook URL must use HTTPS",
      )
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
}
