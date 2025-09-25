import type { Hash } from "viem"
import { SubscriptionRepository } from "../repositories/subscription.repository"
import { OnchainRepository } from "../repositories/onchain.repository"
import { BillingService } from "../services/billing.service"
import { logger } from "../lib/logger"
import { isTestnetEnvironment } from "../lib/constants"
import type { WorkerEnv } from "../../types/api.env"
import type { MessageBatch, Queue } from "@cloudflare/workers-types"
import type { ChargeQueueMessage } from "../schedulers/subscription-charge-scheduler"

export default {
  /**
   * Queue handler - processes charge messages from the charge queue
   * Each message represents a billing entry that needs to be charged
   */
  async queue(
    batch: MessageBatch<ChargeQueueMessage>,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      batchSize: batch.messages.length,
      queueName: batch.queue,
    })

    log.info(`Processing batch of ${batch.messages.length} charge messages`)

    // Process each message in the batch
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const { billingEntryId, subscriptionId, amount } = message.body

        const messageLog = log.with({
          messageId: message.id,
          billingEntryId,
          subscriptionId,
        })
        const op = messageLog.operation("processCharge")

        try {
          op.start()

          // Create service instances
          const subscriptionRepository = new SubscriptionRepository({
            db: env.DB,
          })
          const onchainRepository = new OnchainRepository({
            cdp: {
              apiKeyId: env.CDP_API_KEY_ID,
              apiKeySecret: env.CDP_API_KEY_SECRET,
              walletSecret: env.CDP_WALLET_SECRET,
              walletName: env.CDP_WALLET_NAME,
              paymasterUrl: env.CDP_PAYMASTER_URL,
              smartAccountAddress: env.CDP_SMART_ACCOUNT_ADDRESS,
            },
            testnet: isTestnetEnvironment(env.STAGE),
          })

          const billingService = new BillingService({
            subscriptionRepository,
            onchainRepository,
          })

          // Process the recurring payment
          messageLog.info("Processing recurring payment")
          const result = await billingService.processRecurringPayment({
            billingEntryId,
            subscriptionId,
            amount,
          })

          if (result.success) {
            messageLog.info("Payment processed successfully", {
              transactionHash: result.transactionHash,
              nextBillingCreated: result.nextBillingCreated,
            })

            // ACK the message on success
            message.ack()

            op.success({
              transactionHash: result.transactionHash,
              nextBillingCreated: result.nextBillingCreated,
            })
          } else {
            messageLog.warn("Payment failed", {
              failureReason: result.failureReason,
            })

            // ACK the message even on payment failure (v1: no retries)
            // The subscription has been marked as inactive
            message.ack()

            op.success({
              paymentFailed: true,
              failureReason: result.failureReason,
            })
          }
        } catch (error) {
          op.failure(error)
          messageLog.error("Failed to process charge message", error)

          // Retry the message if there's an unexpected error
          // (not a payment failure, but a system error)
          message.retry()
        }
      }),
    )

    // Log batch processing results
    const successful = results.filter((r) => r.status === "fulfilled").length
    const failed = results.filter((r) => r.status === "rejected").length

    log.info("Batch processing complete", {
      successful,
      failed,
      total: batch.messages.length,
    })
  },
}
