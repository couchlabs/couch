import { createLogger } from "@/lib/logger"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import type { WorkerEnv } from "@/types/dunning.scheduler.env"

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
    env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      trigger: "scheduled",
      scheduledTime: event.scheduledTime,
    })
    const op = log.operation("processDunningRetries")

    try {
      op.start()

      const subscriptionRepository = new SubscriptionRepository(env)

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

  /**
   * HTTP handler - allows manual triggering in dev/preview environments
   * Only available when HTTP_TRIGGER is "true"
   */
  async fetch(
    _request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (env.HTTP_TRIGGER !== "true") {
      return new Response("HTTP trigger not available in this environment", {
        status: 403,
      })
    }

    // Call scheduled() with a mock event
    await this.scheduled(
      {
        scheduledTime: Date.now(),
        cron: "manual-trigger",
      },
      env,
      ctx,
    )

    return new Response("Dunning scheduler triggered successfully", {
      status: 200,
    })
  },
}
