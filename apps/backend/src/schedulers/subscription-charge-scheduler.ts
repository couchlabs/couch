import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { logger } from "@/lib/logger"

import type { subscriptionChargeScheduler } from "@alchemy.run"

export default {
  /**
   * Scheduled handler - runs every 15 minutes via cron
   * Claims due billing entries and sends them to the charge queue
   */
  async scheduled(
    event: ScheduledEvent,
    env: typeof subscriptionChargeScheduler.Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      trigger: "scheduled",
      scheduledTime: event.scheduledTime,
    })
    const op = log.operation("processDueBillingEntries")

    try {
      op.start()

      // Create repository instance
      const subscriptionRepository = new SubscriptionRepository({ db: env.DB })

      // Claim due billing entries atomically
      log.info("Claiming due billing entries")
      const dueBillingEntries =
        await subscriptionRepository.claimDueBillingEntries(100)

      if (dueBillingEntries.length === 0) {
        log.info("No due billing entries found")
        op.success({ entriesProcessed: 0 })
        return
      }

      log.info(`Found ${dueBillingEntries.length} due billing entries`)

      // Send each entry to the charge queue and
      // Wait for all queue sends to complete
      await Promise.all(
        dueBillingEntries.map(async (entry) => {
          const message = {
            billingEntryId: entry.id,
            subscriptionId: entry.subscription_id,
            amount: entry.amount,
            dueAt: entry.due_at,
            attemptNumber: entry.attempts + 1,
          }

          log.info("Sending billing entry to queue", {
            billingEntryId: entry.id,
            subscriptionId: entry.subscription_id,
          })

          return env.CHARGE_QUEUE.send(message)
        }),
      )

      op.success({
        entriesProcessed: dueBillingEntries.length,
      })

      log.info(
        `Successfully queued ${dueBillingEntries.length} billing entries for processing`,
      )
    } catch (error) {
      op.failure(error)
      log.error("Failed to process due billing entries", error)

      // Re-throw to mark the scheduled job as failed
      throw error
    }
  },
}
