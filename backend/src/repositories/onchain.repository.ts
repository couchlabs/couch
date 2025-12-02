import type { Address, Hash } from "viem"
import type { Network } from "@/constants/env.constants"
import { createLogger } from "@/lib/logger"
import { getSubscriptionOwnerWalletName } from "@/lib/subscription-owner-wallet"
import type { Provider } from "@/providers/provider.interface"
import { ProviderRegistry } from "@/providers/provider.registry"

export interface OnchainRepositoryDeps {
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  CDP_CLIENT_API_KEY: string
  NETWORK: Network
}

export interface ChargeSubscriptionParams {
  subscriptionId: Hash
  amount: string
  recipient: Address // Merchant account address to receive the USDC
  provider: Provider
  accountId: number
  testnet: boolean
}

export interface GetSubscriptionStatusParams {
  subscriptionId: Hash
  provider: Provider
  accountId: number
  testnet: boolean
}

export interface ValidateSubscriptionIdParams {
  subscriptionId: string
  provider: Provider
}

export interface RevokeSubscriptionParams {
  subscriptionId: Hash
  provider: Provider
  accountId: number
  testnet: boolean
}

export type SubscriptionStatusResult =
  | {
      subscription: {
        permissionExists: false
        isSubscribed: false
        recurringCharge: string
      }
    }
  | {
      subscription: {
        permissionExists: true
        isSubscribed: boolean
        subscriptionOwner: Address
        remainingChargeInPeriod: string
        currentPeriodStart: Date
        nextPeriodStart?: Date
        recurringCharge: string
        periodInSeconds: number // Converted from provider's periodInDays
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
    const { subscriptionId, amount, recipient, provider, accountId, testnet } =
      params
    const walletName = getSubscriptionOwnerWalletName(accountId)

    const log = logger.with({
      subscriptionId,
      amount,
      recipient,
      provider,
      accountId,
      walletName,
      testnet,
    })

    try {
      log.info("Executing onchain charge via provider")

      const onchainProvider = this.providerRegistry.get(provider)
      const { transactionHash, gasUsed } =
        await onchainProvider.chargeSubscription({
          subscriptionId,
          amount,
          recipient,
          walletName,
          testnet,
        })

      log.info("Onchain charge successful", {
        transactionHash,
        provider,
      })

      return { transactionHash, gasUsed }
    } catch (error) {
      log.error("Onchain charge failed", error)
      throw error
    }
  }

  async getSubscriptionStatus(
    params: GetSubscriptionStatusParams,
  ): Promise<SubscriptionStatusResult> {
    const { subscriptionId, provider, accountId, testnet } = params
    const walletName = getSubscriptionOwnerWalletName(accountId)

    const log = logger.with({
      subscriptionId,
      provider,
      accountId,
      walletName,
      testnet,
    })

    try {
      log.info("Fetching onchain subscription status via provider")

      const onchainProvider = this.providerRegistry.get(provider)
      const result = await onchainProvider.getSubscriptionStatus({
        subscriptionId,
        walletName,
        testnet,
      })

      log.info("Onchain subscription status retrieved", {
        permissionExists: result.permissionExists,
        isSubscribed: result.isSubscribed,
        provider,
      })

      // Permission not found in indexer
      if (!result.permissionExists) {
        return {
          subscription: {
            permissionExists: false,
            isSubscribed: false,
            recurringCharge: result.recurringCharge,
          },
        }
      }

      // Convert period from days to seconds for internal use
      const periodInSeconds = Math.floor(result.periodInDays * 24 * 60 * 60)

      // Return full subscription data
      return {
        subscription: {
          permissionExists: true,
          isSubscribed: result.isSubscribed,
          subscriptionOwner: result.subscriptionOwner,
          remainingChargeInPeriod: result.remainingChargeInPeriod,
          currentPeriodStart: result.currentPeriodStart,
          nextPeriodStart: result.nextPeriodStart,
          recurringCharge: result.recurringCharge,
          periodInSeconds,
        },
      }
    } catch (error) {
      log.error("Failed to get subscription status", error)
      throw error
    }
  }

  async revokeSubscription(
    params: RevokeSubscriptionParams,
  ): Promise<ChargeResult> {
    const { subscriptionId, provider, accountId, testnet } = params
    const walletName = getSubscriptionOwnerWalletName(accountId)

    const log = logger.with({
      subscriptionId,
      provider,
      accountId,
      walletName,
      testnet,
    })

    try {
      log.info("Executing onchain revoke via provider")

      const onchainProvider = this.providerRegistry.get(provider)
      const { transactionHash } = await onchainProvider.revokeSubscription({
        subscriptionId,
        walletName,
        testnet,
      })

      log.info("Onchain revoke successful", {
        transactionHash,
        provider,
      })

      return { transactionHash, gasUsed: undefined }
    } catch (error) {
      log.error("Onchain revoke failed", error)
      throw error
    }
  }

  async validateSubscriptionId(
    params: ValidateSubscriptionIdParams,
  ): Promise<boolean> {
    const onchainProvider = this.providerRegistry.get(params.provider)
    return onchainProvider.validateSubscriptionId(params.subscriptionId)
  }
}
