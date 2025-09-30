import { base } from "@base-org/account"

import { logger } from "@/lib/logger"
import { Network, getNetwork } from "@/constants/env.constants"

import type { Address, Hash } from "viem"

export interface CdpConfig {
  apiKeyId: string
  apiKeySecret: string
  walletSecret: string
  walletName: string
  paymasterUrl: string
  smartAccountAddress: Address
}

export interface OnchainRepositoryConfig {
  cdp: CdpConfig
  testnet: boolean
}

export interface ChargeSubscriptionParams {
  subscriptionId: Hash
  amount: string
}

export interface GetSubscriptionStatusParams {
  subscriptionId: Hash
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
    smartAccountAddress: Address
  }
}

export interface ChargeTransactionResult {
  hash: Hash
  amount: string
  success: boolean
  subscriptionId: Hash
}

export class OnchainRepository {
  private cdp: CdpConfig
  private testnet: boolean
  private network: Network

  constructor(config: OnchainRepositoryConfig) {
    this.cdp = config.cdp
    this.testnet = config.testnet
    this.network = getNetwork(config.testnet)

    logger.info("OnchainRepository initialized", {
      smartAccountAddress: this.cdp.smartAccountAddress,
      network: this.network,
      testnet: this.testnet,
    })
  }

  async chargeSubscription(
    params: ChargeSubscriptionParams,
  ): Promise<ChargeTransactionResult> {
    const { subscriptionId, amount } = params
    const log = logger.with({ subscriptionId, amount })

    try {
      log.info("Executing onchain charge")

      const transaction = await base.subscription.charge({
        cdpApiKeyId: this.cdp.apiKeyId,
        cdpApiKeySecret: this.cdp.apiKeySecret,
        cdpWalletSecret: this.cdp.walletSecret,
        walletName: this.cdp.walletName,
        paymasterUrl: this.cdp.paymasterUrl,
        id: subscriptionId,
        amount,
        testnet: this.testnet,
      })

      // subscription.charge rely on `waitForUserOperation()`, should be definitive
      log.info("Onchain charge successful", {
        transactionHash: transaction.id,
        amount: transaction.amount,
      })

      // Transform external library result to our domain types
      return {
        hash: transaction.id as Hash,
        amount: transaction.amount,
        success: transaction.success,
        subscriptionId: transaction.subscriptionId as Hash,
      }
    } catch (error) {
      log.error("Onchain charge failed", error)
      throw error
    }
  }

  async getSubscriptionStatus(
    params: GetSubscriptionStatusParams,
  ): Promise<SubscriptionStatusResult> {
    const { subscriptionId } = params
    const log = logger.with({ subscriptionId })

    log.info("Fetching onchain subscription status")

    const subscription = await base.subscription.getStatus({
      id: subscriptionId,
      testnet: this.testnet,
    })

    log.info("Onchain subscription status retrieved", {
      isSubscribed: subscription.isSubscribed,
      remainingCharge: subscription.remainingChargeInPeriod,
      nextPeriod: subscription.nextPeriodStart,
      subscriptionOwner: subscription.subscriptionOwner,
    })

    // Return subscription with our wallet address for service layer validation
    return {
      subscription: {
        ...subscription,
        subscriptionOwner: subscription.subscriptionOwner as
          | Address
          | undefined,
      },
      context: {
        smartAccountAddress: this.cdp.smartAccountAddress,
      },
    }
  }
}
