import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { logger } from "@/lib/logger"

import type { orderScheduler } from "@alchemy.run"

export default {
  /**
   * Scheduled handler - runs every 15 minutes via cron
   * Claims due orders and sends them to the order queue
   */
  async scheduled(
    event: ScheduledEvent,
    env: typeof orderScheduler.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      trigger: "scheduled",
      scheduledTime: event.scheduledTime,
    })
    const op = log.operation("processDueOrders")

    try {
      op.start()

      const subscriptionRepository = new SubscriptionRepository({ db: env.DB })

      // Claim due orders atomically
      log.info("Claiming due orders")
      const dueOrders = await subscriptionRepository.claimDueOrders(100)

      if (dueOrders.length === 0) {
        log.info("No due orders found")
        op.success({ entriesProcessed: 0 })
        return
      }

      log.info(`Found ${dueOrders.length} due orders`)
      // Send each order to the charge queue and
      // Wait for all queue sends to complete
      await Promise.all(
        dueOrders.map((order) => {
          const message = {
            orderId: order.id,
            subscriptionId: order.subscription_id,
            amount: order.amount,
            dueAt: order.due_at,
            attemptNumber: order.attempts + 1,
          }

          log.info("Sending order to queue", {
            orderId: order.id,
            subscriptionId: order.subscription_id,
          })

          return env.ORDER_QUEUE.send(message)
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
}
