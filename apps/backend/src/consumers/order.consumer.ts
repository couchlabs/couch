import type { orderQueue } from "@alchemy.run"
import { createLogger } from "@/lib/logger"
import { OrderService } from "@/services/order.service"
import { WebhookService } from "@/services/webhook.service"
import type { WorkerEnv } from "@/types/order.consumer.env"

const logger = createLogger("order.consumer")

export default {
  /**
   * Queue handler - processes order messages from the order queue
   * Each message represents an order that needs to be processed
   */
  async queue(
    batch: typeof orderQueue.Batch,
    env: WorkerEnv,
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
              accountAddress: orderDetails.creatorAddress,
              subscriptionId: orderDetails.subscriptionId,
              orderNumber: result.orderNumber, // Guaranteed to exist
              amount: orderDetails.amount,
              transactionHash: result.transactionHash,
              orderDueAt: new Date(orderDetails.dueAt),
              orderPeriodInSeconds: orderDetails.periodInSeconds,
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

            // Emit webhook for failed payment
            await webhookService.emitPaymentFailed({
              accountAddress: orderDetails.creatorAddress,
              subscriptionId: orderDetails.subscriptionId,
              subscriptionStatus: result.subscriptionStatus,
              orderNumber: result.orderNumber,
              amount: orderDetails.amount,
              periodInSeconds: orderDetails.periodInSeconds,
              failureReason: result.failureReason,
              failureMessage: result.failureMessage,
              nextRetryAt: result.nextRetryAt,
            })

            // ACK the message even on payment failure
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
