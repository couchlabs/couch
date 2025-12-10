import type { WebhookQueueMessage } from "@alchemy.run"
import { createLogger } from "@backend/lib/logger"
import type { WebhookConsumerWorkerEnv } from "@backend-types/webhook.consumer.env"

const logger = createLogger("webhook.consumer")

/**
 * Calculates exponential backoff delay with cap
 * Formula: min(BASE_DELAY * (2 ** attempts), MAX_DELAY)
 *
 * @param attempts - Number of retry attempts (0-indexed)
 * @returns Delay in seconds
 *
 * Example timeline (5s base, 10 retries):
 * - Retry 1: 5s
 * - Retry 2: 10s
 * - Retry 3: 20s
 * - Retry 4: 40s
 * - Retry 5: 80s (~1.3min)
 * - Retry 6: 160s (~2.7min)
 * - Retry 7: 320s (~5.3min)
 * - Retry 8-10: 900s (15min cap)
 * Total window: ~52 minutes
 */
function calculateExponentialBackoff(attempts: number): number {
  const BASE_DELAY_SECONDS = 5 // Faster initial retries
  const MAX_DELAY_SECONDS = 900 // 15 minutes cap

  const delay = BASE_DELAY_SECONDS * 2 ** attempts
  return Math.min(delay, MAX_DELAY_SECONDS)
}

/**
 * Delivers a webhook to the specified URL
 */
async function deliverWebhook(
  message: WebhookQueueMessage,
): Promise<{ success: boolean; status?: number; error?: string }> {
  const { url, payload, signature, timestamp } = message

  try {
    // Deliver pre-signed webhook
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${signature}`,
        "X-Webhook-Timestamp": timestamp.toString(),
      },
      body: payload,
      signal: AbortSignal.timeout(10000), // 10 second timeout
    })

    if (response.ok) {
      return { success: true, status: response.status }
    }

    return {
      success: false,
      status: response.status,
      error: `HTTP ${response.status}: ${response.statusText}`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Webhook delivery consumer
 * Processes webhook messages from the queue and delivers them to merchant endpoints
 */
export default {
  async queue(
    batch: MessageBatch<WebhookQueueMessage>,
    _env: WebhookConsumerWorkerEnv,
  ): Promise<void> {
    const log = logger.with({ consumer: "webhook-delivery" })

    for (const message of batch.messages) {
      const { url } = message.body
      const messageLog = log.with({
        messageId: message.id,
        url,
      })

      messageLog.info("Processing pre-signed webhook delivery")

      const result = await deliverWebhook(message.body)

      if (result.success) {
        messageLog.info("Webhook delivered successfully", {
          status: result.status,
        })
        // Mark message as processed
        message.ack()
      } else {
        const delaySeconds = calculateExponentialBackoff(message.attempts)

        messageLog.error("Webhook delivery failed", {
          status: result.status,
          error: result.error,
          attempt: message.attempts,
          nextRetryInSeconds: delaySeconds,
        })

        // Retry with exponential backoff
        // Queue config handles maxRetries (10) - after exhaustion, routes to WEBHOOK_DLQ
        message.retry({ delaySeconds })
      }
    }
  },
}
