import { base } from "@base-org/account/node"
import type { Address, Hash } from "viem"
import { isHash } from "viem"
import { isTestnetEnvironment, type Stage } from "@/constants/env.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import {
  type ChargeParams,
  type ChargeResult,
  Provider,
  type StatusParams,
  type StatusResult,
  type SubscriptionProvider,
} from "./provider.interface"

export interface BaseProviderDeps {
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  CDP_WALLET_NAME: string
  CDP_PAYMASTER_URL: string
  CDP_SPENDER_ADDRESS: Address
  STAGE: Stage
}

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

  constructor(deps: BaseProviderDeps) {
    this.testnet = isTestnetEnvironment(deps.STAGE)
    this.cdpConfig = {
      apiKeyId: deps.CDP_API_KEY_ID,
      apiKeySecret: deps.CDP_API_KEY_SECRET,
      walletSecret: deps.CDP_WALLET_SECRET,
      walletName: deps.CDP_WALLET_NAME,
      paymasterUrl: deps.CDP_PAYMASTER_URL,
      spenderAddress: deps.CDP_SPENDER_ADDRESS,
    }
  }

  async chargeSubscription(params: ChargeParams): Promise<ChargeResult> {
    try {
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
    } catch (error) {
      throw this.translateChargeError(error)
    }
  }

  /**
   * Gets subscription status from Base SDK.
   *
   * Base SDK behavior:
   * - When permission not found: returns { isSubscribed: false, recurringCharge: '0' }
   * - When permission exists but inactive: returns all fields with isSubscribed: false
   * - When permission exists and active: returns all fields with isSubscribed: true
   * - subscriptionOwner and remainingChargeInPeriod only present when permission exists
   * - nextPeriodStart may be undefined (indicates no future recurring charges)
   * - Throws if subscription hasn't started yet (start time is in future)
   * - Validates chain ID and token address (USDC only)
   */
  async getSubscriptionStatus(params: StatusParams): Promise<StatusResult> {
    const subscription = await base.subscription.getStatus({
      id: params.subscriptionId as Hash,
      testnet: this.testnet,
    })

    return {
      isSubscribed: subscription.isSubscribed,
      subscriptionOwner: subscription.subscriptionOwner as Address,
      remainingChargeInPeriod: subscription.remainingChargeInPeriod,
      spenderAddress: this.cdpConfig.spenderAddress,
      currentPeriodStart: subscription.currentPeriodStart,
      nextPeriodStart: subscription.nextPeriodStart,
      recurringCharge: subscription.recurringCharge,
      periodInDays: subscription.periodInDays,
    }
  }

  validateSubscriptionId(id: string): boolean {
    return isHash(id)
  }

  /**
   * Translates Base SDK errors to domain HTTPError.
   * Only INSUFFICIENT_BALANCE is retryable - everything else logs & continues.
   */
  private translateChargeError(error: unknown): HTTPError {
    if (!(error instanceof Error)) {
      return new HTTPError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "Unknown error during charge",
      )
    }

    const message = error.message.toLowerCase()

    // RETRYABLE: User needs to add funds
    if (message.includes("erc20: transfer amount exceeds balance")) {
      return new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance in wallet to complete payment",
        { originalError: error.message },
      )
    }

    // TERMINAL: User cancelled subscription
    if (message.includes("revoked")) {
      return new HTTPError(
        402,
        ErrorCode.PERMISSION_REVOKED,
        "Subscription permission has been revoked",
        { originalError: error.message },
      )
    }

    if (message.includes("expired")) {
      return new HTTPError(
        402,
        ErrorCode.PERMISSION_EXPIRED,
        "Subscription permission has expired",
        { originalError: error.message },
      )
    }

    // Everything else: log but don't block subscription
    return new HTTPError(500, ErrorCode.PAYMENT_FAILED, "Payment failed", {
      originalError: error.message,
    })
  }
}
