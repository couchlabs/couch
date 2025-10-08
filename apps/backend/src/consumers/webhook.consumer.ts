import type { WebhookQueueMessage } from "@alchemy.run"
import { createLogger } from "@/lib/logger"
import type { WorkerEnv } from "@/types/api.env"

const logger = createLogger("webhook.consumer")

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
    _env: WorkerEnv,
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
        messageLog.error("Webhook delivery failed", {
          status: result.status,
          error: result.error,
          attempt: message.attempts,
        })

        // Retry with exponential backoff (handled by queue settings)
        if (message.attempts < 3) {
          message.retry()
        } else {
          messageLog.error("Webhook delivery failed after max retries")
          // Mark as processed to remove from queue
          message.ack()
        }
      }
    }
  },
}
