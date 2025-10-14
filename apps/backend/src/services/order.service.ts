import type { Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
  TransactionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { decideDunningAction } from "@/lib/dunning.logic"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import { OnchainRepository } from "@/repositories/onchain.repository"
import {
  type OrderDetails,
  SubscriptionRepository,
} from "@/repositories/subscription.repository"
import type { SubscriptionServiceDeps } from "@/services/subscription.service"

// OrderService has same dependencies as SubscriptionService
export type OrderServiceDeps = SubscriptionServiceDeps

export interface ProcessOrderParams {
  orderId: number
  providerId: Provider
}

export type ProcessOrderResult =
  | {
      success: true
      transactionHash: Hash
      orderNumber: number
      nextOrderCreated: boolean
      subscriptionStatus: SubscriptionStatus
    }
  | {
      success: false
      orderNumber: number
      failureReason: string
      failureMessage: string
      nextOrderCreated: boolean
      subscriptionStatus: SubscriptionStatus
      nextRetryAt?: Date
    }

const logger = createLogger("order.service")

export class OrderService {
  private subscriptionRepository: SubscriptionRepository
  private onchainRepository: OnchainRepository

  constructor(env: OrderServiceDeps) {
    this.subscriptionRepository = new SubscriptionRepository(env)
    this.onchainRepository = new OnchainRepository(env)
  }

  /**
   * Create OrderService with injected dependencies for testing
   * Allows mocking repositories without touching production constructor
   */
  static createForTesting(deps: {
    subscriptionRepository: SubscriptionRepository
    onchainRepository: OnchainRepository
  }): OrderService {
    const service = Object.create(OrderService.prototype)
    service.subscriptionRepository = deps.subscriptionRepository
    service.onchainRepository = deps.onchainRepository
    return service
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
        status: TransactionStatus.CONFIRMED,
      })

      // Step 4: Update order as paid and get order_number
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.PAID,
      })

      // Step 4.5: If this was a retry, reactivate subscription
      if (order.status === OrderStatus.FAILED) {
        log.info("Successful retry - reactivating subscription")
        await this.subscriptionRepository.reactivateSubscription({
          orderId,
          subscriptionId: order.subscriptionId,
        })
      }

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
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      }
    } catch (error) {
      op.failure(error)
      log.error("Recurring payment failed", error)

      const errorCode =
        error instanceof HTTPError ? error.code : ErrorCode.PAYMENT_FAILED
      const errorMessage =
        error instanceof Error ? error.message : "Payment failed"

      // Mark order as failed
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.FAILED,
        failureReason: errorCode,
        rawError: errorMessage,
      })

      // Decide dunning action based on error type and retry count
      const action = decideDunningAction({
        error,
        currentAttempts: order.attempts || 0,
        failureDate: new Date(),
      })

      // Execute action based on decision
      switch (action.type) {
        case "terminal": {
          log.info(`Terminal subscription error: ${errorCode}`)

          await this.subscriptionRepository.updateSubscription({
            subscriptionId: order.subscriptionId,
            status: action.subscriptionStatus,
          })

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
          }
        }

        case "retry": {
          log.info(
            `Insufficient balance (attempt ${action.attemptNumber}/${action.attemptNumber}) - scheduling ${action.attemptLabel}`,
            { nextRetryAt: action.nextRetryAt.toISOString() },
          )

          await this.subscriptionRepository.scheduleRetry({
            orderId,
            subscriptionId: order.subscriptionId,
            nextRetryAt: action.nextRetryAt.toISOString(),
            failureReason: errorCode,
            rawError: errorMessage,
          })

          const orderDetails =
            await this.subscriptionRepository.getOrderDetails(orderId)

          return {
            success: false,
            orderNumber: orderDetails?.orderNumber || order.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
            nextRetryAt: action.nextRetryAt,
          }
        }

        case "max_retries_exhausted": {
          log.info("Max retries exhausted")

          await this.subscriptionRepository.updateSubscription({
            subscriptionId: order.subscriptionId,
            status: action.subscriptionStatus,
          })

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
          }
        }

        case "other_error": {
          log.warn(
            `Non-retryable error: ${errorCode} - keeping subscription active`,
          )

          // Get onchain state for next order
          const { subscription: onchainStatus } =
            await this.onchainRepository.getSubscriptionStatus({
              subscriptionId: order.subscriptionId,
              providerId,
            })

          // Create next order if subscription still active
          let nextOrderCreated = false
          if (
            onchainStatus.isSubscribed &&
            onchainStatus.nextPeriodStart &&
            onchainStatus.periodInSeconds
          ) {
            log.info("Creating next order despite failure", {
              reason: "Keep subscription active for recovery",
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

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated,
            subscriptionStatus: action.subscriptionStatus,
          }
        }
      }
    }
  }
}
