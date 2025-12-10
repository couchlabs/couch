import type { orderQueue } from "@alchemy.run"
import { createLogger } from "@backend/lib/logger"
import { calculateUpstreamRetryDelay } from "@backend/lib/retry.logic"
import { OrderService } from "@backend/services/order.service"
import { WebhookService } from "@backend/services/webhook.service"
import type { OrderConsumerWorkerEnv } from "@backend-types/order.consumer.env"

const logger = createLogger("order.consumer")

export default {
  /**
   * Queue handler - processes order messages from the order queue
   * Each message represents an order that needs to be processed
   */
  async queue(
    batch: typeof orderQueue.Batch,
    env: OrderConsumerWorkerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const log = logger.with({
      batchSize: batch.messages.length,
      queueName: batch.queue,
    })

    log.info(`Processing batch of ${batch.messages.length} order messages`)

    // Create shared services for all messages in the batch
    const webhookService = new WebhookService(env)
    const orderService = new OrderService(env)

    // Process each message in the batch
    const results = await Promise.allSettled(
      batch.messages.map(async (message) => {
        const { orderId, provider } = message.body

        const messageLog = log.with({
          messageId: message.id,
          orderId,
        })
        const op = messageLog.operation("processOrder")

        try {
          op.start()

          // Fetch order details for webhook emission
          const orderDetails = await orderService.getOrderDetails(orderId)

          // Process the recurring payment
          messageLog.info("Processing recurring payment")
          const result = await orderService.processOrder({
            orderId,
            provider,
          })

          if (result.success) {
            messageLog.info("Payment processed successfully", {
              transactionHash: result.transactionHash,
              nextOrderCreated: result.nextOrderCreated,
            })

            // Emit webhook for successful payment
            await webhookService.emitPaymentProcessed({
              accountId: orderDetails.accountId,
              subscriptionId: orderDetails.subscriptionId,
              orderNumber: result.orderNumber, // Guaranteed to exist
              amount: orderDetails.amount,
              transactionHash: result.transactionHash,
              orderDueAt: new Date(orderDetails.dueAt),
              orderPeriodInSeconds: orderDetails.periodInSeconds,
              testnet: orderDetails.testnet,
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
              isUpstreamError: result.isUpstreamError,
            })

            // Check if this is an upstream error (external service failure)
            if (result.isUpstreamError) {
              // Calculate exponential backoff delay for retry
              const delaySeconds = calculateUpstreamRetryDelay(message.attempts)

              // Retry message with backoff (will use queue retry mechanism)
              message.retry({ delaySeconds })

              messageLog.info(
                "Upstream service error - retrying with backoff",
                {
                  attempts: message.attempts,
                  nextRetryIn: `${delaySeconds}s`,
                  failureReason: result.failureReason,
                },
              )

              op.success({
                retriedWithBackoff: true,
                delaySeconds,
                attempts: message.attempts,
              })
            } else {
              // Business logic failure (balance, permission, etc) - emit webhook and ack
              await webhookService.emitPaymentFailed({
                accountId: orderDetails.accountId,
                subscriptionId: orderDetails.subscriptionId,
                subscriptionStatus: result.subscriptionStatus,
                orderNumber: result.orderNumber,
                amount: orderDetails.amount,
                periodInSeconds: orderDetails.periodInSeconds,
                testnet: orderDetails.testnet,
                failureReason: result.failureReason,
                failureMessage: result.failureMessage,
                nextRetryAt: result.nextRetryAt,
              })

              // ACK the message (payment failure handled via dunning or subscription cancellation)
              message.ack()

              op.success({
                paymentFailed: true,
                failureReason: result.failureReason,
              })
            }
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
