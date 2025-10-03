import { type Address, type Hash, isAddressEqual } from "viem"
import { OrderStatus, OrderType } from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { getPaymentErrorCode } from "@/errors/subscription.errors"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import {
  type ChargeResult,
  OnchainRepository,
} from "@/repositories/onchain.repository"
import { SubscriptionRepository } from "@/repositories/subscription.repository"

export interface ActivateSubscriptionParams {
  subscriptionId: Hash
  accountAddress: Address // Merchant's account address from auth
  providerId: Provider
}

export interface ValidateSubscriptionIdParams {
  subscriptionId: Hash
  providerId: Provider
}

export interface ActivationResult {
  subscriptionId: Hash
  accountAddress: Address // Include this in the result
  transaction: {
    hash: Hash
    amount: string
  }
  order: {
    id: number
    number: number // Sequential order number from database
    dueAt: string // ISO datetime
    periodInSeconds: number
  }
  nextOrder: {
    date: string
    amount: string
    periodInSeconds: number
  }
}

const logger = createLogger("subscription.service")

export class SubscriptionService {
  private subscriptionRepository: SubscriptionRepository
  private onchainRepository: OnchainRepository

  constructor() {
    this.subscriptionRepository = new SubscriptionRepository()
    this.onchainRepository = new OnchainRepository()
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
          periodInSeconds: result.nextOrder.periodInSeconds,
        },
      })

      log.info("Background subscription activation completed")
    } catch (error) {
      // Log but don't throw - this is background processing
      // TODO: A reconciler should handle incomplete activations
      log.error("Background subscription activation failed", error)
    }
  }

  async validateId(params: ValidateSubscriptionIdParams): Promise<void> {
    const { subscriptionId, providerId } = params

    // Use provider-specific validation
    const isValid = await this.onchainRepository.validateSubscriptionId({
      subscriptionId,
      providerId,
    })

    if (!isValid) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Invalid subscription_id format for the specified provider",
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
    const { subscriptionId, accountAddress, providerId } = params

    // Validate domain constraints
    await this.validateId({ subscriptionId, providerId })

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
        await this.onchainRepository.getSubscriptionStatus({
          subscriptionId,
          providerId,
        })

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
        !isAddressEqual(subscription.subscriptionOwner, context.spenderAddress)
      ) {
        log.warn("Subscription owner mismatch - not authorized to charge", {
          expected: context.spenderAddress,
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

      if (!subscription.currentPeriodStart) {
        logger.error("Missing current period start", { subscriptionId })
        throw new Error(
          "Invalid subscription configuration: missing currentPeriodStart",
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

      if (!subscription.periodInSeconds) {
        logger.error("Missing period in seconds", { subscriptionId })
        throw new Error(
          "Invalid subscription configuration: missing periodInSeconds",
        )
      }

      log.info("Subscription active onchain", {
        remainingCharge: subscription.remainingChargeInPeriod,
        nextPeriod: subscription.nextPeriodStart,
        periodInSeconds: subscription.periodInSeconds,
      })

      // Step 2-3: Create subscription and order atomically
      log.info("Creating subscription and order")
      const { created, orderId, orderNumber } =
        await this.subscriptionRepository.createSubscriptionWithOrder({
          subscriptionId,
          ownerAddress: subscription.subscriptionOwner,
          accountAddress, // Link to merchant's account
          providerId,
          order: {
            subscriptionId: subscriptionId,
            type: OrderType.INITIAL,
            dueAt: new Date().toISOString(),
            amount: String(subscription.remainingChargeInPeriod),
            periodInSeconds: subscription.periodInSeconds,
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

      let transaction: ChargeResult
      if (existingTransaction) {
        log.info("Found existing successful transaction, skipping charge", {
          transactionHash: existingTransaction.transactionHash,
        })
        transaction = {
          transactionHash: existingTransaction.transactionHash, // Already Hash from repository
          gasUsed: undefined,
        }
      } else {
        // Step 5: Execute charge (only if no successful transaction exists)
        log.info("Processing charge", {
          amount: subscription.remainingChargeInPeriod,
          recipient: accountAddress,
        })

        try {
          transaction = await this.onchainRepository.chargeSubscription({
            subscriptionId,
            amount: subscription.remainingChargeInPeriod,
            recipient: accountAddress,
            providerId,
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
        transactionHash: transaction.transactionHash,
        amount: subscription.remainingChargeInPeriod,
      })

      const result: ActivationResult = {
        subscriptionId,
        accountAddress,
        transaction: {
          hash: transaction.transactionHash,
          amount: subscription.remainingChargeInPeriod,
        },
        order: {
          id: orderId,
          number: orderNumber,
          dueAt: new Date().toISOString(),
          periodInSeconds: subscription.periodInSeconds,
        },
        nextOrder: {
          date: subscription.nextPeriodStart.toISOString(),
          amount: String(subscription.recurringCharge),
          periodInSeconds: subscription.periodInSeconds,
        },
      }

      op.success({
        transactionHash: transaction.transactionHash,
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
