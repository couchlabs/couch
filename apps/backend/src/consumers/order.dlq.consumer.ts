import type { orderDLQ } from "@alchemy.run"
import { createLogger } from "@/lib/logger"
import type { WorkerEnv } from "@/types/order.dlq.consumer.env"

const logger = createLogger("order.dlq.consumer")

/**
 * DLQ Consumer for Order Queue
 *
 * Handles messages that failed after maxRetries (3) in the order queue.
 * These represent system errors during order processing, not payment failures.
 *
 * Payment failures are handled gracefully in order.service.ts with status updates.
 * DLQ messages indicate unexpected errors (DB failures, provider crashes, etc.)
 *
 * Current behavior: Log and acknowledge for development visibility
 * Production: Monitor via Cloudflare metrics (outcome:dlq, backlog depth)
 */
export default {
  async queue(
    batch: typeof orderDLQ.Batch,
    _env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      dlq: "ORDER_DLQ",
      batchSize: batch.messages.length,
      queueName: batch.queue,
    })

    log.error("Orders sent to DLQ after max retries", {
      count: batch.messages.length,
    })

    for (const message of batch.messages) {
      const { orderId, providerId } = message.body

      log.error("Order permanently failed - system error", {
        messageId: message.id,
        orderId,
        providerId,
        attempts: message.attempts,
        timestamp: message.timestamp,
      })

      // Acknowledge to prevent reprocessing
      // In production, investigate via logs and Cloudflare metrics
      message.ack()
    }

    log.info("DLQ batch processing complete", {
      processed: batch.messages.length,
    })
  },
}
