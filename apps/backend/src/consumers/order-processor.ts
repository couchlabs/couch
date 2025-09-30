import type { orderProcessor, orderQueue } from "@alchemy.run"
import { isTestnetEnvironment } from "@/constants/env.constants"
import { logger } from "@/lib/logger"
import { OnchainRepository } from "@/repositories/onchain.repository"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { OrderService } from "@/services/order.service"

export default {
  /**
   * Queue handler - processes order messages from the order queue
   * Each message represents an order that needs to be processed
   */
  async queue(
    batch: typeof orderQueue.Batch,
    env: typeof orderProcessor.Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      batchSize: batch.messages.length,
      queueName: batch.queue,
    })

    log.info(`Processing batch of ${batch.messages.length} order messages`)

    // Process each message in the batch
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const { orderId, subscriptionId, amount } = message.body

        const messageLog = log.with({
          messageId: message.id,
          orderId,
          subscriptionId,
        })
        const op = messageLog.operation("processOrder")

        try {
          op.start()

          const orderService = new OrderService({
            subscriptionRepository: new SubscriptionRepository({
              db: env.DB,
            }),
            onchainRepository: new OnchainRepository({
              cdp: {
                apiKeyId: env.CDP_API_KEY_ID,
                apiKeySecret: env.CDP_API_KEY_SECRET,
                walletSecret: env.CDP_WALLET_SECRET,
                walletName: env.CDP_WALLET_NAME,
                paymasterUrl: env.CDP_PAYMASTER_URL,
                smartAccountAddress: env.CDP_SMART_ACCOUNT_ADDRESS,
              },
              testnet: isTestnetEnvironment(env.STAGE),
            }),
          })

          // Process the recurring payment
          messageLog.info("Processing recurring payment")
          const result = await orderService.processOrder({
            orderId,
            subscriptionId,
            amount,
          })

          if (result.success) {
            messageLog.info("Payment processed successfully", {
              transactionHash: result.transactionHash,
              nextOrderCreated: result.nextOrderCreated,
            })

            // ACK the message on success
            message.ack()

            op.success({
              transactionHash: result.transactionHash,
              nextOrderCreated: result.nextOrderCreated,
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
          messageLog.error("Failed to process order message", error)

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
