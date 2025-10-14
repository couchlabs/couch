import { createLogger } from "@/lib/logger"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import type { WorkerEnv } from "@/types/order.scheduler.env"

const logger = createLogger("order.scheduler")

export default {
  /**
   * Scheduled handler - runs every 15 minutes via cron
   * Claims due orders and sends them to the order queue
   */
  async scheduled(
    event: ScheduledEvent,
    env: WorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      trigger: "scheduled",
      scheduledTime: event.scheduledTime,
    })
    const op = log.operation("processDueOrders")

    try {
      op.start()

      const subscriptionRepository = new SubscriptionRepository(env)

      // Claim due orders atomically
      log.info("Claiming due orders")
      const dueOrders = await subscriptionRepository.claimDueOrders(100)

      if (dueOrders.length === 0) {
        log.info("No due orders found")
        op.success({ entriesProcessed: 0 })
        return
      }

      log.info(`Found ${dueOrders.length} due orders`)
      // Send each order to the charge queue
      await Promise.all(
        dueOrders.map((order) => {
          log.info("Sending order to queue", {
            orderId: order.id,
            subscriptionId: order.subscriptionId,
            accountAddress: order.accountAddress,
          })

          return env.ORDER_QUEUE.send({
            orderId: order.id,
            providerId: order.providerId,
          })
        }),
      )

      op.success({
        entriesProcessed: dueOrders.length,
      })

      log.info(`Successfully queued ${dueOrders.length} orders for processing`)
    } catch (error) {
      op.failure(error)
      log.error("Failed to process due orders", error)

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
      } as ScheduledEvent,
      env,
      ctx,
    )

    return new Response("Order scheduler triggered successfully", {
      status: 200,
    })
  },
}
