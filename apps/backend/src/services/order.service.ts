import type { Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { getPaymentErrorCode } from "@/errors/subscription.errors"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import { OnchainRepository } from "@/repositories/onchain.repository"
import {
  type OrderDetails,
  SubscriptionRepository,
} from "@/repositories/subscription.repository"

export interface ProcessOrderParams {
  orderId: number
  providerId: Provider
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
  periodInSeconds: number
}

const logger = createLogger("order.service")

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
  async getOrderDetails(orderId: number): Promise<OrderDetails> {
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
    const { orderId, providerId } = params

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
        subscriptionId: order.subscriptionId,
        accountAddress: order.accountAddress,
        amount: order.amount,
        orderNumber: order.orderNumber,
      })

      // Step 2: Attempt to charge the subscription
      log.info("Processing recurring charge")
      const chargeResult = await this.onchainRepository.chargeSubscription({
        subscriptionId: order.subscriptionId,
        amount: order.amount,
        recipient: order.accountAddress, // Send USDC to merchant account
        providerId,
      })

      // Step 3: Record successful transaction
      log.info("Recording transaction", {
        transactionHash: chargeResult.transactionHash,
      })
      await this.subscriptionRepository.recordTransaction({
        transactionHash: chargeResult.transactionHash,
        orderId,
        subscriptionId: order.subscriptionId,
        amount: order.amount,
        status: "confirmed",
      })

      // Step 4: Update order as paid and get order_number
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.PAID,
      })

      // Step 5: Get next period from onchain (source of truth)
      log.info("Fetching next order period from onchain")
      const { subscription: onchainStatus } =
        await this.onchainRepository.getSubscriptionStatus({
          subscriptionId: order.subscriptionId,
          providerId,
        })

      // Step 5: Create next order
      let nextOrderCreated = false
      if (
        onchainStatus.isSubscribed &&
        onchainStatus.nextPeriodStart &&
        onchainStatus.periodInSeconds
      ) {
        log.info("Creating next order", {
          dueAt: onchainStatus.nextPeriodStart,
          amount: onchainStatus.recurringCharge,
        })

        await this.subscriptionRepository.createOrder({
          subscriptionId: order.subscriptionId,
          type: OrderType.RECURRING,
          dueAt: onchainStatus.nextPeriodStart.toISOString(),
          amount: String(onchainStatus.recurringCharge),
          periodInSeconds: onchainStatus.periodInSeconds,
          status: OrderStatus.PENDING,
        })
        nextOrderCreated = true
      }

      op.success({
        transactionHash: chargeResult.transactionHash,
        nextOrderCreated,
      })

      return {
        success: true,
        transactionHash: chargeResult.transactionHash,
        orderNumber: orderResult.orderNumber, // Always defined - updateOrder throws if not found
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

      // Mark subscription as unpaid (Phase 1: no retries, terminal state)
      // Phase 2 will change this to PAST_DUE with retry logic
      log.info("Marking subscription as unpaid due to payment failure")
      await this.subscriptionRepository.updateSubscription({
        subscriptionId: order.subscriptionId,
        status: SubscriptionStatus.UNPAID,
      })

      return {
        success: false,
        orderNumber: orderResult.orderNumber, // Always defined - updateOrder throws if not found
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
    const { subscriptionId, dueAt, amount, periodInSeconds } = params

    const log = logger.with({
      subscriptionId,
      dueAt: dueAt.toISOString(),
      amount,
    })
    log.info("Scheduling next order")

    await this.subscriptionRepository.createOrder({
      subscriptionId: subscriptionId,
      type: OrderType.RECURRING,
      dueAt: dueAt.toISOString(),
      amount,
      periodInSeconds,
      status: OrderStatus.PENDING,
    })
  }
}
