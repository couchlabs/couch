import type { orderScheduler } from "@alchemy.run"
import { logger } from "@/lib/logger"
import { SubscriptionRepository } from "@/repositories/subscription.repository"

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

      const subscriptionRepository = new SubscriptionRepository()

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
            subscriptionId: order.subscription_id,
            accountAddress: order.account_address,
          })

          return env.ORDER_QUEUE.send({ orderId: order.id })
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
