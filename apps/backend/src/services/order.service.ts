import type { Hash } from "viem"
import { OrderStatus, OrderType } from "@/constants/subscription.constants"
import { getPaymentErrorCode } from "@/errors/subscription.errors"
import { logger } from "@/lib/logger"
import { OnchainRepository } from "@/repositories/onchain.repository"
import { SubscriptionRepository } from "@/repositories/subscription.repository"

export interface ProcessOrderParams {
  orderId: number // Everything else will be fetched from the database
}

export interface ProcessOrderResult {
  success: boolean
  transactionHash?: Hash
  orderNumber: number // Always returned - updateOrder throws if order not found
  failureReason?: string
  nextOrderCreated: boolean
}

export interface ScheduleNextOrderParams {
  subscriptionId: Hash
  dueAt: Date
  amount: string
}

export class OrderService {
  private subscriptionRepository: SubscriptionRepository
  private onchainRepository: OnchainRepository

  constructor() {
    this.subscriptionRepository = new SubscriptionRepository()
    this.onchainRepository = new OnchainRepository()
  }

  /**
   * Get order details for webhook emission
   * Throws if order not found
   */
  async getOrderDetails(orderId: number) {
    const log = logger.with({ orderId })

    const orderDetails =
      await this.subscriptionRepository.getOrderDetails(orderId)
    if (!orderDetails) {
      log.error(`Order ${orderId} not found in database`)
      throw new Error(`Order ${orderId} not found`)
    }

    return orderDetails
  }

  /**
   * Process a recurring payment for an order
   * Creates next order on success, marks subscription inactive on failure
   */
  async processOrder(params: ProcessOrderParams): Promise<ProcessOrderResult> {
    const { orderId } = params

    const log = logger.with({ orderId })
    const op = log.operation("processOrder")
    op.start()

    // Step 1: Fetch order details from database (outside try to make it available in catch)
    log.info("Fetching order details")
    const order = await this.subscriptionRepository.getOrderDetails(orderId)

    if (!order) {
      op.failure(new Error(`Order ${orderId} not found`))
      throw new Error(`Order ${orderId} not found`)
    }

    try {
      // Add details to logging context
      log.info("Order details fetched", {
        subscriptionId: order.subscription_id,
        accountAddress: order.account_address,
        amount: order.amount,
        orderNumber: order.order_number,
      })

      // Step 2: Attempt to charge the subscription
      log.info("Processing recurring charge")
      const chargeResult = await this.onchainRepository.chargeSubscription({
        subscriptionId: order.subscription_id,
        amount: order.amount,
        recipient: order.account_address, // Send USDC to merchant account
      })

      // Step 3: Record successful transaction
      log.info("Recording transaction", {
        transactionHash: chargeResult.hash,
      })
      await this.subscriptionRepository.recordTransaction({
        transactionHash: chargeResult.hash,
        orderId,
        subscriptionId: order.subscription_id,
        amount: chargeResult.amount,
        status: "confirmed",
      })

      // Step 4: Update order as paid and get order_number
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.PAID,
      })

      // Step 5: Get next period from onchain (source of truth)
      log.info("Fetching next order period from onchain")
      const { subscription } =
        await this.onchainRepository.getSubscriptionStatus({
          subscriptionId: order.subscription_id,
        })

      // Step 5: Create next order
      let nextOrderCreated = false
      if (subscription.isSubscribed && subscription.nextPeriodStart) {
        log.info("Creating next order", {
          dueAt: subscription.nextPeriodStart,
          amount: subscription.recurringCharge,
        })

        await this.subscriptionRepository.createOrder({
          subscription_id: order.subscription_id,
          type: OrderType.RECURRING,
          due_at: subscription.nextPeriodStart.toISOString(),
          amount: String(subscription.recurringCharge),
          status: OrderStatus.PENDING,
        })
        nextOrderCreated = true
      }

      op.success({
        transactionHash: chargeResult.hash,
        nextOrderCreated,
      })

      return {
        success: true,
        transactionHash: chargeResult.hash,
        orderNumber: orderResult.order_number, // Always defined - updateOrder throws if not found
        nextOrderCreated,
      }
    } catch (error) {
      op.failure(error)
      log.error("Recurring payment failed", error)

      const errorCode = getPaymentErrorCode(error)
      const rawError = error instanceof Error ? error.message : String(error)

      // Mark order as failed with both mapped code and raw error
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.FAILED,
        failureReason: errorCode,
        rawError: rawError,
      })

      // Mark subscription as inactive (v1: no retries)
      log.info("Marking subscription as inactive due to payment failure")
      await this.subscriptionRepository.updateSubscription({
        subscriptionId: order.subscription_id,
        status: "inactive",
      })

      return {
        success: false,
        orderNumber: orderResult.order_number, // Always defined - updateOrder throws if not found
        failureReason: errorCode,
        nextOrderCreated: false,
      }
    }
  }

  /**
   * Schedule next order for a subscription
   * Used when we need to create an order outside of payment processing
   */
  async scheduleNextOrder(params: ScheduleNextOrderParams): Promise<void> {
    const { subscriptionId, dueAt, amount } = params

    const log = logger.with({
      subscriptionId,
      dueAt: dueAt.toISOString(),
      amount,
    })
    log.info("Scheduling next order")

    await this.subscriptionRepository.createOrder({
      subscription_id: subscriptionId,
      type: OrderType.RECURRING,
      due_at: dueAt.toISOString(),
      amount,
      status: OrderStatus.PENDING,
    })
  }
}
