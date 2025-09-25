import type { Hash } from "viem"

import { getPaymentErrorCode } from "@/services/subscription.service.errors"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { OnchainRepository } from "@/repositories/onchain.repository"
import {
  BillingStatus,
  BillingType,
} from "@/repositories/subscription.repository.constants"
import { logger } from "@/lib/logger"

export interface ProcessRecurringPaymentParams {
  billingEntryId: number
  subscriptionId: Hash
  amount: string
}

export interface RecurringPaymentResult {
  success: boolean
  transactionHash?: Hash
  failureReason?: string
  nextBillingCreated: boolean
}

export interface ScheduleNextBillingParams {
  subscriptionId: Hash
  dueAt: Date
  amount: string
}

export class BillingService {
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
   * Process a recurring payment for a billing entry
   * Creates next billing entry on success, marks subscription inactive on failure
   */
  async processRecurringPayment(
    params: ProcessRecurringPaymentParams,
  ): Promise<RecurringPaymentResult> {
    const { billingEntryId, subscriptionId, amount } = params

    const log = logger.with({
      billingEntryId,
      subscriptionId,
      amount,
    })
    const op = log.operation("processRecurringPayment")

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
        billingEntryId,
        subscriptionId,
        amount: chargeResult.amount,
        status: "confirmed",
      })

      // Step 3: Update billing entry as completed
      await this.subscriptionRepository.updateBillingEntry({
        id: billingEntryId,
        status: BillingStatus.COMPLETED,
      })

      // Step 4: Get next period from onchain (source of truth)
      log.info("Fetching next billing period from onchain")
      const { subscription } =
        await this.onchainRepository.getSubscriptionStatus({
          subscriptionId,
        })

      // Step 5: Create next billing entry
      let nextBillingCreated = false
      if (subscription.isSubscribed && subscription.nextPeriodStart) {
        log.info("Creating next billing entry", {
          dueAt: subscription.nextPeriodStart,
          amount: subscription.recurringCharge,
        })

        await this.subscriptionRepository.createBillingEntry({
          subscription_id: subscriptionId,
          type: BillingType.RECURRING,
          due_at: subscription.nextPeriodStart.toISOString(),
          amount: String(subscription.recurringCharge),
          status: BillingStatus.PENDING,
        })
        nextBillingCreated = true
      }

      op.success({
        transactionHash: chargeResult.hash,
        nextBillingCreated,
      })

      return {
        success: true,
        transactionHash: chargeResult.hash,
        nextBillingCreated,
      }
    } catch (error) {
      op.failure(error)
      log.error("Recurring payment failed", error)

      const errorCode = getPaymentErrorCode(error)
      const rawError = error instanceof Error ? error.message : String(error)

      // Mark billing entry as failed with both mapped code and raw error
      await this.subscriptionRepository.updateBillingEntry({
        id: billingEntryId,
        status: BillingStatus.FAILED,
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
        nextBillingCreated: false,
      }
    }
  }

  /**
   * Schedule next billing for a subscription
   * Used when we need to create a billing entry outside of payment processing
   */
  async scheduleNextBilling(params: ScheduleNextBillingParams): Promise<void> {
    const { subscriptionId, dueAt, amount } = params

    const log = logger.with({
      subscriptionId,
      dueAt: dueAt.toISOString(),
      amount,
    })
    log.info("Scheduling next billing")

    await this.subscriptionRepository.createBillingEntry({
      subscription_id: subscriptionId,
      type: BillingType.RECURRING,
      due_at: dueAt.toISOString(),
      amount,
      status: BillingStatus.PENDING,
    })
  }
}
