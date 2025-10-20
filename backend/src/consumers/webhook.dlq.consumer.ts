import type { webhookDLQ } from "@alchemy.run"
import { createLogger } from "@/lib/logger"
import type { WorkerEnv } from "@/types/webhook.dlq.consumer.env"

const logger = createLogger("webhook.dlq.consumer")

/**
 * DLQ Consumer for Webhook Queue
 *
 * Handles webhook delivery failures after maxRetries (10) with exponential backoff.
 * These represent permanently unreachable merchant endpoints.
 *
 * Common causes:
 * - Merchant endpoint down/offline
 * - Invalid webhook URL configuration
 * - Network/firewall issues
 * - SSL certificate errors
 *
 * Current behavior: Log and acknowledge for development visibility
 * Production: Monitor via Cloudflare metrics (outcome:dlq, backlog depth)
 * Merchants should implement proper webhook endpoint monitoring
 */
export default {
  async queue(
    batch: typeof webhookDLQ.Batch,
    _env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      dlq: "WEBHOOK_DLQ",
      batchSize: batch.messages.length,
      queueName: batch.queue,
    })

    log.error("Webhooks sent to DLQ after max retries", {
      count: batch.messages.length,
    })

    for (const message of batch.messages) {
      const { url, timestamp } = message.body

      log.error("Webhook permanently failed - endpoint unreachable", {
        messageId: message.id,
        url,
        attempts: message.attempts,
        timestamp: message.timestamp,
        eventTimestamp: timestamp,
      })

      // Acknowledge to prevent reprocessing
      // In production, merchants should monitor their webhook endpoints
      // Investigate via logs and Cloudflare metrics
      message.ack()
    }

    log.info("DLQ batch processing complete", {
      processed: batch.messages.length,
    })
  },
}
