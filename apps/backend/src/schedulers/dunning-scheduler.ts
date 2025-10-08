import type { dunningScheduler } from "@alchemy.run"
import { createLogger } from "@/lib/logger"
import { SubscriptionRepository } from "@/repositories/subscription.repository"

const logger = createLogger("dunning-scheduler")

/**
 * Dunning Scheduler
 * Runs hourly to process payment retries for subscriptions in past_due status
 *
 * Flow:
 * 1. Queries orders with next_retry_at <= now
 * 2. Sends each order to ORDER_QUEUE for processing
 * 3. OrderService handles the actual charge attempt
 */
export default {
  async scheduled(
    event: ScheduledEvent,
    env: typeof dunningScheduler.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      trigger: "scheduled",
      scheduledTime: event.scheduledTime,
    })
    const op = log.operation("processDunningRetries")

    try {
      op.start()

      const subscriptionRepository = new SubscriptionRepository()

      // Find orders due for retry
      log.info("Finding orders due for retry")
      const dueRetries = await subscriptionRepository.getDueRetries(100)

      if (dueRetries.length === 0) {
        log.info("No orders due for retry")
        op.success({ entriesProcessed: 0 })
        return
      }

      log.info(`Found ${dueRetries.length} orders due for retry`)

      // Send each order to the queue
      await Promise.all(
        dueRetries.map((retry) => {
          log.info("Sending order to queue for retry", {
            orderId: retry.id,
            subscriptionId: retry.subscriptionId,
            attempts: retry.attempts,
          })

          return env.ORDER_QUEUE.send({
            orderId: retry.id,
            providerId: retry.providerId,
          })
        }),
      )

      op.success({
        entriesProcessed: dueRetries.length,
      })

      log.info(`Successfully queued ${dueRetries.length} orders for retry`)
    } catch (error) {
      op.failure(error)
      log.error("Failed to process dunning retries", error)

      // Re-throw to mark the scheduled job as failed
      throw error
    }
  },
}
