import type { Address, Hash } from "viem"
import { createLogger } from "@/lib/logger"
import { type Provider, providers } from "@/providers"

export interface ChargeSubscriptionParams {
  subscriptionId: Hash
  amount: string
  recipient: Address // Merchant account address to receive the USDC
  providerId: Provider
}

export interface GetSubscriptionStatusParams {
  subscriptionId: Hash
  providerId: Provider
}

export interface ValidateSubscriptionIdParams {
  subscriptionId: string
  providerId: Provider
}

export interface SubscriptionStatusResult {
  subscription: {
    isSubscribed: boolean
    subscriptionOwner?: Address
    remainingChargeInPeriod?: string
    nextPeriodStart?: Date
    recurringCharge?: string
  }
  context: {
    spenderAddress: Address
  }
}

export interface ChargeResult {
  transactionHash: Hash
  gasUsed?: string
}

const logger = createLogger("onchain.repository")

export class OnchainRepository {
  constructor() {
    logger.info("OnchainRepository initialized with provider factory")
  }

  async chargeSubscription(
    params: ChargeSubscriptionParams,
  ): Promise<ChargeResult> {
    const { subscriptionId, amount, recipient, providerId } = params
    const log = logger.with({ subscriptionId, amount, recipient, providerId })

    try {
      log.info("Executing onchain charge via provider")

      const provider = providers.getProvider(providerId)
      const { transactionHash, gasUsed } = await provider.chargeSubscription({
        subscriptionId,
        amount,
        recipient,
      })

      log.info("Onchain charge successful", { transactionHash, providerId })

      return { transactionHash, gasUsed }
    } catch (error) {
      log.error("Onchain charge failed", error)
      throw error
    }
  }

  async getSubscriptionStatus(
    params: GetSubscriptionStatusParams,
  ): Promise<SubscriptionStatusResult> {
    const { subscriptionId, providerId } = params
    const log = logger.with({ subscriptionId, providerId })

    try {
      log.info("Fetching onchain subscription status via provider")

      const provider = providers.getProvider(providerId)
      const {
        isSubscribed,
        subscriptionOwner,
        remainingChargeInPeriod,
        spenderAddress,
        nextPeriodStart,
        recurringCharge,
      } = await provider.getSubscriptionStatus({ subscriptionId })

      log.info("Onchain subscription status retrieved", {
        isSubscribed,
        subscriptionOwner,
        remainingChargeInPeriod,
        providerId,
      })

      // Log warning if subscription is active but owner is missing
      if (isSubscribed && !subscriptionOwner) {
        log.warn("Active subscription has no owner", {
          subscriptionId,
          isSubscribed,
          providerId,
        })
      }

      // Return subscription data
      return {
        subscription: {
          isSubscribed,
          subscriptionOwner,
          remainingChargeInPeriod,
          nextPeriodStart,
          recurringCharge,
        },
        context: { spenderAddress },
      }
    } catch (error) {
      log.error("Failed to get subscription status", error)
      throw error
    }
  }

  async validateSubscriptionId(
    params: ValidateSubscriptionIdParams,
  ): Promise<boolean> {
    const provider = providers.getProvider(params.providerId)
    return provider.validateSubscriptionId(params.subscriptionId)
  }
}
