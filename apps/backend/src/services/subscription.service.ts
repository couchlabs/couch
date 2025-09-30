import { type Address, type Hash, isAddressEqual, isHash } from "viem"
import { OrderStatus, OrderType } from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { getPaymentErrorCode } from "@/errors/subscription.errors"
import { logger } from "@/lib/logger"
import type {
  ChargeTransactionResult,
  OnchainRepository,
} from "@/repositories/onchain.repository"
import type { SubscriptionRepository } from "@/repositories/subscription.repository"

export interface ActivateSubscriptionParams {
  subscriptionId: Hash
  accountAddress: Address // Merchant's account address from auth
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
  order: {
    id: number
  }
  nextOrder: {
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
   * This includes database updates and scheduling next order.
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
        order: result.order,
        transaction: result.transaction,
        nextOrder: {
          dueAt: result.nextOrder.date,
          amount: result.nextOrder.amount,
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
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
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
    const { subscriptionId, accountAddress } = params

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
        throw new HTTPError(
          409,
          ErrorCode.SUBSCRIPTION_EXISTS,
          "Subscription already exists",
          { subscriptionId },
        )
      }

      // Step 2: Get onchain subscription status
      log.info("Fetching onchain subscription status")
      const { subscription, context } =
        await this.onchainRepository.getSubscriptionStatus({ subscriptionId })

      if (!subscription.isSubscribed) {
        throw new HTTPError(
          403,
          ErrorCode.SUBSCRIPTION_NOT_ACTIVE,
          "Subscription not active",
          { subscriptionId },
        )
      }

      if (!subscription.subscriptionOwner) {
        logger.error("Missing subscription owner", { subscriptionId })
        throw new Error(
          "Invalid subscription configuration: missing subscriptionOwner",
        )
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
        throw new HTTPError(
          403,
          ErrorCode.FORBIDDEN,
          "Unauthorized to charge subscription",
          { subscriptionId },
        )
      }

      if (!subscription.remainingChargeInPeriod) {
        logger.error("Missing remaining charge in period", { subscriptionId })
        throw new Error(
          "Invalid subscription configuration: missing remainingChargeInPeriod",
        )
      }

      if (!subscription.nextPeriodStart) {
        logger.error("Missing next period start", { subscriptionId })
        throw new Error(
          "Invalid subscription configuration: missing nextPeriodStart",
        )
      }

      if (!subscription.recurringCharge) {
        logger.error("Missing recurring charge", { subscriptionId })
        throw new Error(
          "Invalid subscription configuration: missing recurringCharge",
        )
      }

      log.info("Subscription active onchain", {
        remainingCharge: subscription.remainingChargeInPeriod,
        nextPeriod: subscription.nextPeriodStart,
      })

      // Step 2-3: Create subscription and order atomically
      log.info("Creating subscription and order")
      const { created, orderId } =
        await this.subscriptionRepository.createSubscriptionWithOrder({
          subscriptionId,
          ownerAddress: subscription.subscriptionOwner,
          accountAddress, // Link to merchant's account
          order: {
            subscription_id: subscriptionId,
            type: OrderType.INITIAL,
            due_at: new Date().toISOString(),
            amount: String(subscription.remainingChargeInPeriod),
            status: OrderStatus.PROCESSING,
          },
        })

      if (!created) {
        throw new HTTPError(
          409,
          ErrorCode.SUBSCRIPTION_EXISTS,
          "Subscription already exists",
          { subscriptionId },
        )
      }

      // Step 4: Check for existing successful transaction (idempotency)
      // This saves some gas by avoiding to charge an already processed order
      const existingTransaction =
        await this.subscriptionRepository.getSuccessfulTransaction({
          subscriptionId,
          orderId: orderId,
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

          // COMPENSATING ACTION: Mark subscription and order as inactive/failed
          log.info("Marking subscription as inactive due to payment failure", {
            subscriptionId,
            errorCode,
            orderId: orderId,
          })

          await this.subscriptionRepository.markSubscriptionInactive({
            subscriptionId,
            orderId: orderId,
            reason: chargeError.message,
          })

          // Only expose user-actionable payment errors
          if (
            errorCode === ErrorCode.INSUFFICIENT_BALANCE ||
            errorCode === ErrorCode.PERMISSION_EXPIRED
          ) {
            throw new HTTPError(
              402,
              errorCode,
              errorCode === ErrorCode.INSUFFICIENT_BALANCE
                ? "Insufficient balance to complete payment"
                : "Subscription permission has expired",
              { subscriptionId, amount: chargeAmount },
            )
          }

          // For all other payment errors, return generic message
          throw new HTTPError(402, ErrorCode.PAYMENT_FAILED, "Payment failed", {
            subscriptionId,
          })
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
        order: {
          id: orderId,
        },
        nextOrder: {
          date: subscription.nextPeriodStart.toISOString(),
          amount: String(subscription.recurringCharge),
        },
      }

      op.success({
        transactionHash: transaction.hash,
        nextOrderDate: subscription.nextPeriodStart,
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
