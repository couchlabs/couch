import { ChargeResult } from "@base-org/account"
import { isHash, isAddressEqual } from "viem"

import { SubscriptionRepository } from "../repositories/subscription.repository"
import { OnchainRepository } from "../repositories/onchain.repository"
import { logger } from "../lib/logger"
import { APIErrors } from "../subscription-api.errors"
import {
  SubscriptionErrors,
  getPaymentErrorCode,
} from "./subscription.service.errors"
import {
  BillingType,
  BillingStatus,
} from "../repositories/subscription.repository.constants"
import { Stage, isTestnetEnvironment } from "../lib/constants"
import { env } from "cloudflare:workers"

export interface ActivateSubscriptionParams {
  subscriptionId: string
}

export interface ValidateSubscriptionIdParams {
  subscriptionId: string
}

export interface GetServiceInstanceParams {
  subscriptionRepository?: SubscriptionRepository
  onchainRepository?: OnchainRepository
}

export interface Subscription {
  subscription_id: string
  transaction_hash: string
  next_billing_date: string
}

export interface SubscriptionContext {
  subscriptionId: string
  billingEntryId: number
  transaction: ChargeResult
  nextPeriod: {
    dueAt: string
    amount: string
  }
}

export interface SubscriptionResult {
  subscription: Subscription
  context: SubscriptionContext
}

export class SubscriptionService {
  private static instance: SubscriptionService | null = null
  private subscriptionRepository: SubscriptionRepository
  private onchainRepository: OnchainRepository

  private constructor(config: {
    subscriptionRepository: SubscriptionRepository
    onchainRepository: OnchainRepository
  }) {
    this.subscriptionRepository = config.subscriptionRepository
    this.onchainRepository = config.onchainRepository
  }

  static async getInstance(params?: GetServiceInstanceParams) {
    if (!this.instance) {
      // Use provided dependencies or create defaults
      const subscriptionRepository =
        params?.subscriptionRepository ||
        new SubscriptionRepository({ db: env.DB })

      const onchainRepository =
        params?.onchainRepository ||
        (await OnchainRepository.create({
          cdpConfig: {
            apiKeyId: env.CDP_API_KEY_ID,
            apiKeySecret: env.CDP_API_KEY_SECRET,
            walletSecret: env.CDP_WALLET_SECRET,
            walletName: env.CDP_WALLET_NAME,
            paymasterUrl: env.CDP_PAYMASTER_URL,
          },
          testnet: isTestnetEnvironment(env.STAGE as Stage),
        }))

      this.instance = new SubscriptionService({
        subscriptionRepository,
        onchainRepository,
      })
    }
    return this.instance
  }

  // Reset singleton for testing
  static resetInstance(): void {
    this.instance = null
  }

  /**
   * Performs cleanup when subscription activation fails.
   * Attempts to revoke on-chain permission first, then cleans database.
   * Best-effort: continues even if individual steps fail.
   */
  private async performActivationCleanup(params: {
    subscriptionId: string
    log: any
  }): Promise<void> {
    const { subscriptionId, log } = params

    // Step 1: Revoke onchain permission (most important, most likely to fail)
    try {
      const revokeResult = await this.onchainRepository.revokePermission({
        subscriptionId,
      })

      if (revokeResult.success) {
        log.info("Permission successfully revoked onchain", {
          transactionHash: revokeResult.transactionHash,
        })
      } else {
        // Log but continue with DB cleanup
        // Our reconciler scheduler should pick up the orphan subscription
        log.warn("Failed to revoke permission onchain", revokeResult.error)
      }
    } catch (revokeError) {
      // Log but continue with DB cleanup
      log.warn("Exception during permission revocation", revokeError)
    }

    // Step 2: Clean up database (only after attempting revocation)
    try {
      await this.subscriptionRepository.deleteSubscriptionData({
        subscriptionId,
      })
      log.info("Database cleanup completed")
    } catch (cleanupError) {
      log.warn("Database cleanup failed", cleanupError)
      // Don't throw - we've done our best effort cleanup
    }
  }

  /**
   * Completes the subscription setup in the background.
   * This includes database updates and scheduling next billing.
   */
  async completeSubscriptionSetup(context: SubscriptionContext): Promise<void> {
    const log = logger.with({
      subscriptionId: context.subscriptionId,
      transactionHash: context.transaction.id,
    })

    try {
      log.info("Completing subscription setup in background")

      await this.subscriptionRepository.executeSubscriptionActivation({
        subscriptionId: context.subscriptionId,
        billingEntryId: context.billingEntryId,
        transaction: context.transaction,
        nextBilling: context.nextPeriod,
      })

      log.info("Background subscription setup completed")
    } catch (error) {
      // Log but don't throw - this is background processing
      // TODO: A reconciler should handle incomplete setups
      log.error("Background subscription setup failed", error)
    }
  }

  static validateSubscriptionId(params: ValidateSubscriptionIdParams): void {
    const { subscriptionId } = params
    if (!isHash(subscriptionId)) {
      throw APIErrors.invalidRequest(
        "Invalid subscription_id format. Must be a 32-byte hash",
      )
    }
  }

  /**
   * Activates a subscription by validating and charging immediately.
   * Database finalization happens in the background via completeSubscriptionSetup.
   */
  async activateSubscription(
    params: ActivateSubscriptionParams,
  ): Promise<SubscriptionResult> {
    const { subscriptionId } = params

    // Validate domain constraints
    SubscriptionService.validateSubscriptionId({ subscriptionId })

    const log = logger.with({ subscriptionId })
    const op = log.operation("activateSubscription")

    let shouldCleanup = false

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

      shouldCleanup = true

      // Step 4: Check for existing successful transaction (idempotency)
      // This saves some gas by avoiding to charge an already processed billing entry
      const existingTransaction =
        await this.subscriptionRepository.getSuccessfulTransaction({
          subscriptionId,
          billingEntryId: billingEntryId!,
        })

      let transaction: ChargeResult
      if (existingTransaction) {
        log.info("Found existing successful transaction, skipping charge", {
          transactionHash: existingTransaction.tx_hash,
        })
        transaction = {
          id: existingTransaction.tx_hash,
          amount: existingTransaction.amount,
          success: true,
          subscriptionId,
        } as ChargeResult
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

          // COMPENSATING ACTION: Mark subscription and billing as failed
          await this.subscriptionRepository.markSubscriptionFailed({
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
        transactionHash: transaction.id,
        amount: transaction.amount,
      })

      const result: SubscriptionResult = {
        subscription: {
          subscription_id: subscriptionId,
          transaction_hash: transaction.id,
          next_billing_date: subscription.nextPeriodStart.toISOString(),
        },
        context: {
          subscriptionId,
          billingEntryId: billingEntryId!,
          transaction,
          nextPeriod: {
            dueAt: subscription.nextPeriodStart.toISOString(),
            amount: String(subscription.recurringCharge),
          },
        },
      }

      op.success({
        transactionHash: transaction.id,
        nextBillingDate: subscription.nextPeriodStart,
      })

      return result
    } catch (error) {
      op.failure(error)

      // Cleanup on failure
      if (shouldCleanup) {
        await this.performActivationCleanup({ subscriptionId, log })
      }

      throw error
    }
  }
}
