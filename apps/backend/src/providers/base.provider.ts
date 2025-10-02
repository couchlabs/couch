import { env } from "cloudflare:workers"
import { base } from "@base-org/account"
import type { Address, Hash } from "viem"
import { isHash } from "viem"
import {
  type ChargeParams,
  type ChargeResult,
  Provider,
  type StatusParams,
  type StatusResult,
  type SubscriptionProvider,
} from "./provider.interface"

export class BaseProvider implements SubscriptionProvider {
  readonly providerId = Provider.BASE
  private readonly testnet: boolean
  private readonly cdpConfig: {
    apiKeyId: string
    apiKeySecret: string
    walletSecret: string
    walletName: string
    paymasterUrl: string
    spenderAddress: Address
  }

  constructor(testnet: boolean) {
    this.testnet = testnet
    this.cdpConfig = {
      apiKeyId: env.CDP_API_KEY_ID,
      apiKeySecret: env.CDP_API_KEY_SECRET,
      walletSecret: env.CDP_WALLET_SECRET,
      walletName: env.CDP_WALLET_NAME,
      paymasterUrl: env.CDP_PAYMASTER_URL,
      spenderAddress: env.CDP_SPENDER_ADDRESS,
    }
  }

  async chargeSubscription(params: ChargeParams): Promise<ChargeResult> {
    const result = await base.subscription.charge({
      cdpApiKeyId: this.cdpConfig.apiKeyId,
      cdpApiKeySecret: this.cdpConfig.apiKeySecret,
      cdpWalletSecret: this.cdpConfig.walletSecret,
      walletName: this.cdpConfig.walletName,
      paymasterUrl: this.cdpConfig.paymasterUrl,
      id: params.subscriptionId as Hash,
      amount: params.amount,
      recipient: params.recipient,
      testnet: this.testnet,
    })

    return {
      transactionHash: result.id as Hash, // Base SDK returns transaction hash as 'id'
      success: result.success,
      gasUsed: undefined, // Base SDK doesn't provide gas usage in the response
    }
  }

  async getSubscriptionStatus(params: StatusParams): Promise<StatusResult> {
    const subscription = await base.subscription.getStatus({
      id: params.subscriptionId as Hash,
      testnet: this.testnet,
    })

    return {
      isSubscribed: subscription.isSubscribed,
      subscriptionOwner: subscription.subscriptionOwner as Address,
      remainingChargeInPeriod: Number(subscription.remainingChargeInPeriod),
      spenderAddress: this.cdpConfig.spenderAddress,
    }
  }

  validateSubscriptionId(id: string): boolean {
    return isHash(id)
  }
}
