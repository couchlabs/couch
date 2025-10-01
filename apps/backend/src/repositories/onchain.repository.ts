import { env } from "cloudflare:workers"
import { base } from "@base-org/account"
import type { Address, Hash } from "viem"
import {
  getNetwork,
  isTestnetEnvironment,
  type Network,
} from "@/constants/env.constants"
import { logger } from "@/lib/logger"

interface CdpConfig {
  apiKeyId: string
  apiKeySecret: string
  walletSecret: string
  walletName: string
  paymasterUrl: string
  spenderAddress: Address
}

export interface ChargeSubscriptionParams {
  subscriptionId: Hash
  amount: string
  recipient: Address // Merchant account address to receive the USDC
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
    spenderAddress: Address
  }
}

export interface ChargeSubscriptionResult {
  hash: Hash
  amount: string
  success: boolean
  subscriptionId: Hash
}

export class OnchainRepository {
  private cdp: CdpConfig
  private testnet: boolean
  private network: Network

  constructor() {
    this.cdp = {
      apiKeyId: env.CDP_API_KEY_ID,
      apiKeySecret: env.CDP_API_KEY_SECRET,
      walletSecret: env.CDP_WALLET_SECRET,
      walletName: env.CDP_WALLET_NAME,
      spenderAddress: env.CDP_SPENDER_ADDRESS,
      paymasterUrl: env.CDP_PAYMASTER_URL,
    }

    this.testnet = isTestnetEnvironment(env.STAGE)
    this.network = getNetwork(this.testnet)

    logger.info("OnchainRepository initialized", {
      spenderAddress: this.cdp.spenderAddress,
      network: this.network,
      testnet: this.testnet,
    })
  }

  async chargeSubscription(
    params: ChargeSubscriptionParams,
  ): Promise<ChargeSubscriptionResult> {
    const { subscriptionId, amount, recipient } = params
    const log = logger.with({ subscriptionId, amount, recipient })

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
        recipient,
        testnet: this.testnet,
      })

      // subscription.charge rely on `waitForUserOperation()`, should be definitive
      log.info("Onchain charge successful", {
        transactionHash: transaction.id,
        amount: transaction.amount,
        recipient,
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

    // Log warning if subscription is active but owner is missing
    if (subscription.isSubscribed && !subscription.subscriptionOwner) {
      log.warn("Active subscription has no owner", {
        subscriptionId,
        isSubscribed: subscription.isSubscribed,
      })
    }

    // Return subscription with our wallet address for service layer validation
    return {
      subscription: {
        ...subscription,
        subscriptionOwner: subscription.subscriptionOwner as
          | Address
          | undefined,
      },
      context: {
        spenderAddress: this.cdp.spenderAddress,
      },
    }
  }
}
