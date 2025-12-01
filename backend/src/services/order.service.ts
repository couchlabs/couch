import type { Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
  TransactionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { isUpstreamServiceError } from "@/errors/subscription.errors"
import { decideDunningAction } from "@/lib/dunning.logic"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import {
  OnchainRepository,
  type OnchainRepositoryDeps,
} from "@/repositories/onchain.repository"
import {
  type OrderDetails,
  SubscriptionRepository,
  type SubscriptionRepositoryDeps,
} from "@/repositories/subscription.repository"
import type { WorkerEnv } from "@/types/api.env"

// Define the minimal dependencies needed by OrderService
// We pick ORDER_SCHEDULER from WorkerEnv to get the exact Alchemy-generated type
export interface OrderServiceDeps
  extends SubscriptionRepositoryDeps,
    OnchainRepositoryDeps,
    Pick<WorkerEnv, "ORDER_SCHEDULER"> {}

export interface ProcessOrderParams {
  orderId: number
  provider: Provider
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
      isUpstreamError: boolean // True for upstream service errors (should retry via queue)
    }

const logger = createLogger("order.service")

export class OrderService {
  private subscriptionRepository: SubscriptionRepository
  private onchainRepository: OnchainRepository
  private deps: OrderServiceDeps

  constructor(deps: OrderServiceDeps) {
    this.deps = deps
    this.subscriptionRepository = new SubscriptionRepository(deps)
    this.onchainRepository = new OnchainRepository(deps)
  }

  /**
   * Create OrderService with injected dependencies for testing
   * Allows mocking repositories without touching production constructor
   */
  static createForTesting(deps: {
    subscriptionRepository: SubscriptionRepository
    onchainRepository: OnchainRepository
    env?: OrderServiceDeps
  }): OrderService {
    const service = Object.create(OrderService.prototype)
    service.subscriptionRepository = deps.subscriptionRepository
    service.onchainRepository = deps.onchainRepository
    service.deps = deps.env
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
   * Helper: Create and schedule next order if subscription is still active
   * Returns true if next order was created and scheduled
   */
  private async createAndScheduleNextOrder(params: {
    subscriptionId: Hash
    onchainStatus: {
      isSubscribed: boolean
      nextPeriodStart?: Date
      periodInSeconds?: number
      recurringCharge: string | bigint
    }
    provider: Provider
    log: ReturnType<typeof logger.with>
    logReason?: string
  }): Promise<boolean> {
    const { subscriptionId, onchainStatus, provider, log, logReason } = params

    if (
      !onchainStatus.isSubscribed ||
      !onchainStatus.nextPeriodStart ||
      !onchainStatus.periodInSeconds
    ) {
      return false
    }

    const logMessage = logReason
      ? `Creating next order ${logReason}`
      : "Creating next order"

    log.info(logMessage, {
      dueAt: onchainStatus.nextPeriodStart,
      amount: onchainStatus.recurringCharge,
    })

    const nextOrderId = await this.subscriptionRepository.createOrder({
      subscriptionId,
      type: OrderType.RECURRING,
      dueAt: onchainStatus.nextPeriodStart.toISOString(),
      amount: String(onchainStatus.recurringCharge),
      periodInSeconds: onchainStatus.periodInSeconds,
      status: OrderStatus.PENDING,
    })

    if (!nextOrderId) {
      return false
    }

    // Schedule the next order via Durable Object
    const scheduler = this.deps.ORDER_SCHEDULER.get(
      this.deps.ORDER_SCHEDULER.idFromName(String(nextOrderId)),
    )

    await scheduler.set({
      orderId: nextOrderId,
      dueAt: onchainStatus.nextPeriodStart,
      provider,
    })

    const scheduledMessage = logReason
      ? `Scheduled next order ${logReason}`
      : "Scheduled next order"

    log.info(scheduledMessage, {
      nextOrderId,
      dueAt: onchainStatus.nextPeriodStart.toISOString(),
    })

    return true
  }

  /**
   * Process a recurring payment for an order
   * Creates next order on success, marks subscription inactive on failure
   */
  async processOrder(params: ProcessOrderParams): Promise<ProcessOrderResult> {
    const { orderId, provider } = params

    const log = logger.with({ orderId })
    const op = log.operation("processOrder")
    op.start()

    // Get scheduler instance for this order (reuse throughout method)
    const scheduler = this.deps.ORDER_SCHEDULER.get(
      this.deps.ORDER_SCHEDULER.idFromName(String(orderId)),
    )

    // Step 1: Fetch order details from database (outside try to make it available in catch)
    log.info("Fetching order details")
    const order = await this.subscriptionRepository.getOrderDetails(orderId)

    if (!order) {
      op.failure(new Error(`Order ${orderId} not found`))
      throw new Error(`Order ${orderId} not found`)
    }

    const {
      subscriptionId,
      accountId,
      beneficiaryAddress,
      amount,
      status,
      orderNumber,
      attempts,
    } = order

    try {
      // Add details to logging context
      log.info("Order details fetched", {
        subscriptionId,
        accountId,
        beneficiaryAddress,
        amount,
        orderNumber,
      })

      // Step 2: Attempt to charge the subscription
      log.info("Processing recurring charge")
      const chargeResult = await this.onchainRepository.chargeSubscription({
        subscriptionId,
        amount,
        recipient: beneficiaryAddress, // Send USDC to beneficiary
        provider,
        accountId,
      })

      // Step 3: Record successful transaction
      log.info("Recording transaction", {
        transactionHash: chargeResult.transactionHash,
      })
      await this.subscriptionRepository.recordTransaction({
        transactionHash: chargeResult.transactionHash,
        orderId,
        subscriptionId,
        amount,
        status: TransactionStatus.CONFIRMED,
      })

      // Step 4: Update order as paid and get order_number
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.PAID,
      })

      // Step 4.5: If this was a retry, reactivate subscription
      if (status === OrderStatus.FAILED) {
        log.info("Successful retry - reactivating subscription")
        await this.subscriptionRepository.reactivateSubscription({
          orderId,
          subscriptionId,
        })
      }

      // Step 5: Get next period from onchain (source of truth)
      log.info("Fetching next order period from onchain")
      const { subscription: onchainStatus } =
        await this.onchainRepository.getSubscriptionStatus({
          subscriptionId,
          provider,
          accountId,
        })

      // Step 5: Create next order
      const nextOrderCreated = await this.createAndScheduleNextOrder({
        subscriptionId,
        onchainStatus,
        provider,
        log,
      })

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

      // Extract original blockchain error from HTTPError details if available
      // Provider errors store originalError in details.originalError
      let rawError = errorMessage
      if (error instanceof HTTPError && error.details?.originalError) {
        rawError = error.details.originalError
      }

      // Mark order as failed
      const orderResult = await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.FAILED,
        failureReason: errorCode,
        rawError,
      })

      // Decide dunning action based on error type and retry count
      const action = decideDunningAction({
        error,
        currentAttempts: attempts || 0,
        failureDate: new Date(),
      })

      // Execute action based on decision
      switch (action.type) {
        case "terminal": {
          log.info(`Terminal subscription error: ${errorCode}`)

          // Clean up failed order's scheduler
          await scheduler.delete()
          log.info("Deleted failed order scheduler", { orderId })

          await this.subscriptionRepository.updateSubscription({
            subscriptionId,
            status: action.subscriptionStatus,
          })

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
            isUpstreamError: isUpstreamServiceError(error),
          }
        }

        case "retry": {
          log.info(
            `Insufficient balance (attempt ${action.attemptNumber}/${action.attemptNumber}) - scheduling ${action.attemptLabel}`,
            { nextRetryAt: action.nextRetryAt.toISOString() },
          )

          await this.subscriptionRepository.scheduleRetry({
            orderId,
            subscriptionId,
            nextRetryAt: action.nextRetryAt.toISOString(),
            failureReason: errorCode,
            rawError,
          })

          // Reschedule this order for retry via Durable Object
          await scheduler.update({
            dueAt: action.nextRetryAt,
            provider,
          })

          log.info("Rescheduled order for retry", {
            nextRetryAt: action.nextRetryAt.toISOString(),
          })

          const orderDetails =
            await this.subscriptionRepository.getOrderDetails(orderId)

          return {
            success: false,
            orderNumber: orderDetails?.orderNumber || orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
            nextRetryAt: action.nextRetryAt,
            isUpstreamError: isUpstreamServiceError(error),
          }
        }

        case "max_retries_exhausted": {
          log.info("Max retries exhausted")

          // Clean up failed order's scheduler
          await scheduler.delete()
          log.info("Deleted failed order scheduler", { orderId })

          await this.subscriptionRepository.updateSubscription({
            subscriptionId,
            status: action.subscriptionStatus,
          })

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
            isUpstreamError: isUpstreamServiceError(error),
          }
        }

        case "upstream_error": {
          log.info(
            `Upstream service error: ${errorCode} - will retry via queue with exponential backoff`,
          )

          // DON'T delete scheduler - keep as backup in case queue retries fail
          // DON'T create next order - queue will retry current order

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
            isUpstreamError: true, // Tell consumer to use queue retry
          }
        }

        case "user_operation_failed": {
          log.warn(
            `User operation failed: ${errorCode} - bundler rejected during simulation`,
          )

          // Clean up failed order's scheduler to prevent alarm retries
          await scheduler.delete()
          log.info("Deleted failed order scheduler", { orderId })

          // DON'T create next order - prevents cascade duplication in batch processing
          // In parallel batch processing, another order likely succeeded
          // Common causes: duplicate charge, insufficient balance, nonce conflicts

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated: false,
            subscriptionStatus: action.subscriptionStatus,
            isUpstreamError: false,
          }
        }

        case "other_error": {
          log.warn(
            `Non-retryable error: ${errorCode} - keeping subscription active`,
          )

          // Clean up failed order's scheduler to prevent alarm retries
          await scheduler.delete()
          log.info("Deleted failed order scheduler", { orderId })

          // Get onchain state for next order
          const { subscription: onchainStatus } =
            await this.onchainRepository.getSubscriptionStatus({
              subscriptionId,
              provider,
              accountId,
            })

          // Create next order if subscription still active
          const nextOrderCreated = await this.createAndScheduleNextOrder({
            subscriptionId,
            onchainStatus,
            provider,
            log,
            logReason: "despite failure",
          })

          return {
            success: false,
            orderNumber: orderResult.orderNumber,
            failureReason: errorCode,
            failureMessage: errorMessage,
            nextOrderCreated,
            subscriptionStatus: action.subscriptionStatus,
            isUpstreamError: isUpstreamServiceError(error),
          }
        }
      }
    }
  }
}
