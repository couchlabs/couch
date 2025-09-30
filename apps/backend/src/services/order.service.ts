import type { Hash } from "viem"
import { OrderStatus, OrderType } from "@/constants/subscription.constants"
import { getPaymentErrorCode } from "@/errors/subscription.errors"
import { logger } from "@/lib/logger"
import type { OnchainRepository } from "@/repositories/onchain.repository"
import type { SubscriptionRepository } from "@/repositories/subscription.repository"

export interface ProcessOrderParams {
  orderId: number
  subscriptionId: Hash
  amount: string
}

export interface ProcessOrderResult {
  success: boolean
  transactionHash?: Hash
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

  constructor(deps: {
    subscriptionRepository: SubscriptionRepository
    onchainRepository: OnchainRepository
  }) {
    this.subscriptionRepository = deps.subscriptionRepository
    this.onchainRepository = deps.onchainRepository
  }

  /**
   * Process a recurring payment for an order
   * Creates next order on success, marks subscription inactive on failure
   */
  async processOrder(params: ProcessOrderParams): Promise<ProcessOrderResult> {
    const { orderId, subscriptionId, amount } = params

    const log = logger.with({
      orderId,
      subscriptionId,
      amount,
    })
    const op = log.operation("processOrder")

    try {
      op.start()

      // Step 1: Attempt to charge the subscription
      log.info("Processing recurring charge")
      const chargeResult = await this.onchainRepository.chargeSubscription({
        subscriptionId,
        amount,
      })

      // Step 2: Record successful transaction
      log.info("Recording transaction", {
        transactionHash: chargeResult.hash,
      })
      await this.subscriptionRepository.recordTransaction({
        transactionHash: chargeResult.hash,
        orderId,
        subscriptionId,
        amount: chargeResult.amount,
        status: "confirmed",
      })

      // Step 3: Update order as paid
      await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.PAID,
      })

      // Step 4: Get next period from onchain (source of truth)
      log.info("Fetching next order period from onchain")
      const { subscription } =
        await this.onchainRepository.getSubscriptionStatus({
          subscriptionId,
        })

      // Step 5: Create next order
      let nextOrderCreated = false
      if (subscription.isSubscribed && subscription.nextPeriodStart) {
        log.info("Creating next order", {
          dueAt: subscription.nextPeriodStart,
          amount: subscription.recurringCharge,
        })

        await this.subscriptionRepository.createOrder({
          subscription_id: subscriptionId,
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
        nextOrderCreated,
      }
    } catch (error) {
      op.failure(error)
      log.error("Recurring payment failed", error)

      const errorCode = getPaymentErrorCode(error)
      const rawError = error instanceof Error ? error.message : String(error)

      // Mark order as failed with both mapped code and raw error
      await this.subscriptionRepository.updateOrder({
        id: orderId,
        status: OrderStatus.FAILED,
        failureReason: errorCode,
        rawError: rawError,
      })

      // Mark subscription as inactive (v1: no retries)
      log.info("Marking subscription as inactive due to payment failure")
      await this.subscriptionRepository.updateSubscription({
        subscriptionId,
        status: "inactive",
      })

      return {
        success: false,
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
