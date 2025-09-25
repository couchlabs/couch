import { isHash, isAddressEqual, type Hash } from "viem"

import { SubscriptionRepository } from "../repositories/subscription.repository"
import {
  OnchainRepository,
  type ChargeTransactionResult,
} from "../repositories/onchain.repository"
import { logger } from "../lib/logger"
import { APIErrors } from "../api/subscription-api.errors"
import {
  SubscriptionErrors,
  getPaymentErrorCode,
} from "./subscription.service.errors"
import {
  BillingType,
  BillingStatus,
} from "../repositories/subscription.repository.constants"

export interface ActivateSubscriptionParams {
  subscriptionId: Hash
}

export interface ValidateSubscriptionIdParams {
  subscriptionId: Hash
}

export interface ActivationResult {
  subscriptionId: Hash
  transaction: {
    hash: Hash
    amount: string
  }
  billingEntry: {
    id: number
  }
  nextBilling: {
    date: string
    amount: string
  }
}

export class SubscriptionService {
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
   * Completes the subscription activation in the background.
   * This includes database updates and scheduling next billing.
   * Errors are logged but not thrown since this runs in background.
   */
  async completeActivation(result: ActivationResult): Promise<void> {
    const log = logger.with({
      subscriptionId: result.subscriptionId,
      transactionHash: result.transaction.hash,
    })

    try {
      log.info("Completing subscription activation in background")

      await this.subscriptionRepository.executeSubscriptionActivation({
        subscriptionId: result.subscriptionId,
        billingEntry: result.billingEntry,
        transaction: result.transaction,
        nextBilling: {
          dueAt: result.nextBilling.date,
          amount: result.nextBilling.amount,
        },
      })

      log.info("Background subscription activation completed")
    } catch (error) {
      // Log but don't throw - this is background processing
      // TODO: A reconciler should handle incomplete activations
      log.error("Background subscription activation failed", error)
    }
  }

  static validateId(params: ValidateSubscriptionIdParams): void {
    const { subscriptionId } = params
    if (!isHash(subscriptionId)) {
      throw APIErrors.invalidRequest(
        "Invalid subscription_id format. Must be a 32-byte hash",
      )
    }
  }

  /**
   * Activates a subscription by validating and charging immediately.
   * Database finalization happens in the background via completeActivation.
   */
  async activate(
    params: ActivateSubscriptionParams,
  ): Promise<ActivationResult> {
    const { subscriptionId } = params

    // Validate domain constraints
    SubscriptionService.validateId({ subscriptionId })

    const log = logger.with({ subscriptionId })
    const op = log.operation("activate")

    try {
      op.start()

      // Step 1: Check if subscription already exists (early exit)
      const exists = await this.subscriptionRepository.subscriptionExists({
        subscriptionId,
      })
      if (exists) {
        throw APIErrors.subscriptionExists(subscriptionId)
      }

      // Step 2: Get onchain subscription status
      log.info("Fetching onchain subscription status")
      const { subscription, context } =
        await this.onchainRepository.getSubscriptionStatus({ subscriptionId })

      if (!subscription.isSubscribed) {
        throw APIErrors.permissionNotActive(subscriptionId)
      }

      if (!subscription.subscriptionOwner) {
        throw SubscriptionErrors.missingSubscriptionOwner()
      }

      // Verify the subscription owner matches our smart wallet
      if (
        !isAddressEqual(
          subscription.subscriptionOwner,
          context.smartAccountAddress,
        )
      ) {
        log.warn("Subscription owner mismatch - not authorized to charge", {
          expected: context.smartAccountAddress,
          actual: subscription.subscriptionOwner,
          subscriptionId,
        })
        throw SubscriptionErrors.unauthorizedSpender(
          context.smartAccountAddress,
          subscription.subscriptionOwner,
        )
      }

      if (!subscription.remainingChargeInPeriod) {
        throw SubscriptionErrors.missingRemainingCharge()
      }

      if (!subscription.nextPeriodStart) {
        throw SubscriptionErrors.missingNextPeriodStart()
      }

      if (!subscription.recurringCharge) {
        throw SubscriptionErrors.missingRecurringCharge()
      }

      log.info("Subscription active onchain", {
        remainingCharge: subscription.remainingChargeInPeriod,
        nextPeriod: subscription.nextPeriodStart,
      })

      // Step 2-3: Create subscription and billing entry atomically
      log.info("Creating subscription and billing entry")
      const { created, billingEntryId } =
        await this.subscriptionRepository.createSubscriptionWithBilling({
          subscriptionId,
          accountAddress: subscription.subscriptionOwner,
          billingEntry: {
            subscription_id: subscriptionId,
            type: BillingType.RECURRING,
            due_at: new Date().toISOString(),
            amount: String(subscription.remainingChargeInPeriod),
            status: BillingStatus.PROCESSING,
          },
        })

      if (!created) {
        throw APIErrors.subscriptionExists(subscriptionId)
      }

      // Step 4: Check for existing successful transaction (idempotency)
      // This saves some gas by avoiding to charge an already processed billing entry
      const existingTransaction =
        await this.subscriptionRepository.getSuccessfulTransaction({
          subscriptionId,
          billingEntryId: billingEntryId!,
        })

      let transaction: ChargeTransactionResult
      if (existingTransaction) {
        log.info("Found existing successful transaction, skipping charge", {
          transactionHash: existingTransaction.transaction_hash,
        })
        transaction = {
          hash: existingTransaction.transaction_hash, // Already Hash from repository
          amount: existingTransaction.amount,
          success: true,
          subscriptionId,
        }
      } else {
        // Step 5: Execute charge (only if no successful transaction exists)
        log.info("Processing charge", {
          amount: subscription.remainingChargeInPeriod,
        })

        try {
          transaction = await this.onchainRepository.chargeSubscription({
            subscriptionId,
            amount: subscription.remainingChargeInPeriod,
          })
        } catch (chargeError) {
          log.error("Charge failed", chargeError)

          const errorCode = getPaymentErrorCode(chargeError)
          const chargeAmount = subscription.remainingChargeInPeriod

          log.info("Payment failed with error code", {
            original: chargeError.message,
            errorCode,
            amount: chargeAmount,
          })

          // COMPENSATING ACTION: Mark subscription and billing as inactive/failed
          log.info("Marking subscription as inactive due to payment failure", {
            subscriptionId,
            errorCode,
            billingEntryId: billingEntryId!,
          })

          await this.subscriptionRepository.markSubscriptionInactive({
            subscriptionId,
            billingEntryId: billingEntryId!,
            reason: chargeError.message,
          })

          throw APIErrors.paymentFailed(
            errorCode,
            { subscriptionId, amount: chargeAmount },
            chargeError,
          )
        }
      }

      log.info("Charge successful", {
        transactionHash: transaction.hash,
        amount: transaction.amount,
      })

      const result: ActivationResult = {
        subscriptionId,
        transaction: {
          hash: transaction.hash,
          amount: transaction.amount,
        },
        billingEntry: {
          id: billingEntryId!,
        },
        nextBilling: {
          date: subscription.nextPeriodStart.toISOString(),
          amount: String(subscription.recurringCharge),
        },
      }

      op.success({
        transactionHash: transaction.hash,
        nextBillingDate: subscription.nextPeriodStart,
      })

      return result
    } catch (error) {
      op.failure(error)

      // No cleanup needed - subscription already marked as inactive
      // On-chain permission will orphan (harmless)

      throw error
    }
  }
}
