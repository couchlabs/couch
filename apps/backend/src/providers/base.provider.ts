import { base } from "@base-org/account/node"
import type { Address, Hash } from "viem"
import { isHash } from "viem"
import type { Network } from "@/constants/env.constants"
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
  CDP_CLIENT_API_KEY: string
  CDP_SPENDER_ADDRESS: Address
  NETWORK: Network
}

export class BaseProvider implements SubscriptionProvider {
  readonly providerId = Provider.BASE
  private readonly network: Network
  private readonly cdpConfig: {
    apiKeyId: string
    apiKeySecret: string
    walletSecret: string
    walletName: string
    clientApiKey: string
    spenderAddress: Address
  }

  constructor(deps: BaseProviderDeps) {
    this.network = deps.NETWORK
    this.cdpConfig = {
      apiKeyId: deps.CDP_API_KEY_ID,
      apiKeySecret: deps.CDP_API_KEY_SECRET,
      walletSecret: deps.CDP_WALLET_SECRET,
      walletName: deps.CDP_WALLET_NAME,
      clientApiKey: deps.CDP_CLIENT_API_KEY,
      spenderAddress: deps.CDP_SPENDER_ADDRESS,
    }
  }

  async chargeSubscription(params: ChargeParams): Promise<ChargeResult> {
    try {
      // Paymaster URL must match the network (base-sepolia for testnet, base for mainnet)
      const network = this.network === "testnet" ? "base-sepolia" : "base"
      const paymasterUrl = `https://api.developer.coinbase.com/rpc/v1/${network}/${this.cdpConfig.clientApiKey}`

      const result = await base.subscription.charge({
        cdpApiKeyId: this.cdpConfig.apiKeyId,
        cdpApiKeySecret: this.cdpConfig.apiKeySecret,
        cdpWalletSecret: this.cdpConfig.walletSecret,
        walletName: this.cdpConfig.walletName,
        paymasterUrl,
        id: params.subscriptionId as Hash,
        amount: params.amount,
        recipient: params.recipient,
        testnet: this.network === "testnet",
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
      testnet: this.network === "testnet",
    })

    // Check if permission exists in indexer by validating required fields
    // SDK returns minimal data when permission not found: { isSubscribed: false, recurringCharge: '0' }
    if (
      !subscription.subscriptionOwner ||
      !subscription.remainingChargeInPeriod ||
      !subscription.currentPeriodStart ||
      subscription.periodInDays === undefined
    ) {
      return {
        permissionExists: false,
        isSubscribed: false, // SDK always returns false when permission not found
        recurringCharge: subscription.recurringCharge,
        spenderAddress: this.cdpConfig.spenderAddress,
      }
    }

    return {
      permissionExists: true,
      isSubscribed: subscription.isSubscribed,
      subscriptionOwner: subscription.subscriptionOwner as Address,
      remainingChargeInPeriod: subscription.remainingChargeInPeriod,
      currentPeriodStart: subscription.currentPeriodStart,
      nextPeriodStart: subscription.nextPeriodStart,
      recurringCharge: subscription.recurringCharge,
      periodInDays: subscription.periodInDays,
      spenderAddress: this.cdpConfig.spenderAddress,
    }
  }

  validateSubscriptionId(id: string): boolean {
    return isHash(id)
  }

  /**
   * Translates Base SDK errors to domain HTTPError.
   * Classifies errors into:
   * - UPSTREAM_SERVICE_ERROR: External infrastructure failures (retryable via queue)
   * - INSUFFICIENT_BALANCE: User payment error (retryable via dunning)
   * - PERMISSION_REVOKED/EXPIRED: Terminal errors (cancel subscription)
   * - PAYMENT_FAILED: Unknown errors (keep subscription active, create next order)
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

    // UPSTREAM SERVICE ERRORS: External infrastructure failures (CDP, Base SDK, AWS, bundlers)
    // Detect 5xx errors, timeouts, and service unavailability
    // These are retryable via queue with exponential backoff
    if (
      message.includes("error code: 5") || // 500, 502, 503, 504, etc
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("gateway") ||
      message.includes("unavailable") ||
      message.includes("service unavailable") ||
      message.includes("try again") ||
      message.includes("temporarily") ||
      message.includes("overload")
    ) {
      return new HTTPError(
        503,
        ErrorCode.UPSTREAM_SERVICE_ERROR,
        "Payment provider temporarily unavailable",
        { originalError: error.message },
      )
    }

    // RETRYABLE: User needs to add funds (dunning system)
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
