import type { Address, Hash } from "viem"
import type { Network } from "@/constants/env.constants"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import { ProviderRegistry } from "@/providers/provider.registry"

export interface OnchainRepositoryDeps {
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  CDP_WALLET_NAME: string
  CDP_CLIENT_API_KEY: string
  CDP_SPENDER_ADDRESS: Address
  NETWORK: Network
}

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
    currentPeriodStart?: Date
    nextPeriodStart?: Date
    recurringCharge?: string
    periodInSeconds?: number // Converted from provider's periodInDays
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
  private providerRegistry: ProviderRegistry

  constructor(env: OnchainRepositoryDeps) {
    this.providerRegistry = new ProviderRegistry({ Base: env })
    logger.info("OnchainRepository initialized with provider registry")
  }

  async chargeSubscription(
    params: ChargeSubscriptionParams,
  ): Promise<ChargeResult> {
    const { subscriptionId, amount, recipient, providerId } = params
    const log = logger.with({ subscriptionId, amount, recipient, providerId })

    try {
      log.info("Executing onchain charge via provider")

      const provider = this.providerRegistry.get(providerId)
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

      const provider = this.providerRegistry.get(providerId)
      const {
        isSubscribed,
        subscriptionOwner,
        remainingChargeInPeriod,
        spenderAddress,
        currentPeriodStart,
        nextPeriodStart,
        recurringCharge,
        periodInDays,
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

      // Convert period from days to seconds for internal use
      // TODO: Move into helper function
      const periodInSeconds =
        periodInDays !== undefined
          ? Math.floor(periodInDays * 24 * 60 * 60)
          : undefined

      // Return subscription data
      return {
        subscription: {
          isSubscribed,
          subscriptionOwner,
          remainingChargeInPeriod,
          currentPeriodStart,
          nextPeriodStart,
          recurringCharge,
          periodInSeconds,
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
    const provider = this.providerRegistry.get(params.providerId)
    return provider.validateSubscriptionId(params.subscriptionId)
  }
}
