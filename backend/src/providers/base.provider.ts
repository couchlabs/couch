import { base } from "@base-org/account/node"
import type { Address, Hash } from "viem"
import { isHash } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import {
  type ChargeParams,
  type ChargeResult,
  Provider,
  type RevokeParams,
  type RevokeResult,
  type StatusParams,
  type StatusResult,
  type SubscriptionProvider,
} from "./provider.interface"

export interface BaseProviderDeps {
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  CDP_CLIENT_API_KEY: string
}

export class BaseProvider implements SubscriptionProvider {
  readonly providerId = Provider.BASE
  private readonly cdpConfig: {
    apiKeyId: string
    apiKeySecret: string
    walletSecret: string
    clientApiKey: string
  }

  constructor(deps: BaseProviderDeps) {
    this.cdpConfig = {
      apiKeyId: deps.CDP_API_KEY_ID,
      apiKeySecret: deps.CDP_API_KEY_SECRET,
      walletSecret: deps.CDP_WALLET_SECRET,
      clientApiKey: deps.CDP_CLIENT_API_KEY,
    }

    // Set RPC URLs for Base SDK to use CDP managed infrastructure
    // This works with our patched @base-org/account package which checks RPC_URL_<CHAIN_ID>
    // Base mainnet (chainId: 8453)
    process.env.RPC_URL_8453 = `https://api.developer.coinbase.com/rpc/v1/base/${deps.CDP_CLIENT_API_KEY}`
    // Base Sepolia testnet (chainId: 84532)
    process.env.RPC_URL_84532 = `https://api.developer.coinbase.com/rpc/v1/base-sepolia/${deps.CDP_CLIENT_API_KEY}`
  }

  /**
   * Constructs paymaster URL based on testnet parameter
   * - testnet: true -> base-sepolia
   * - testnet: false -> base (mainnet)
   */
  private getPaymasterUrl(testnet: boolean): string {
    const network = testnet ? "base-sepolia" : "base"
    return `https://api.developer.coinbase.com/rpc/v1/${network}/${this.cdpConfig.clientApiKey}`
  }

  async chargeSubscription(params: ChargeParams): Promise<ChargeResult> {
    try {
      const result = await base.subscription.charge({
        cdpApiKeyId: this.cdpConfig.apiKeyId,
        cdpApiKeySecret: this.cdpConfig.apiKeySecret,
        cdpWalletSecret: this.cdpConfig.walletSecret,
        walletName: params.walletName,
        paymasterUrl: this.getPaymasterUrl(params.testnet),
        id: params.subscriptionId as Hash,
        amount: params.amount,
        recipient: params.recipient,
        testnet: params.testnet,
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
      testnet: params.testnet,
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
    }
  }

  async revokeSubscription(params: RevokeParams): Promise<RevokeResult> {
    const result = await base.subscription.revoke({
      cdpApiKeyId: this.cdpConfig.apiKeyId,
      cdpApiKeySecret: this.cdpConfig.apiKeySecret,
      cdpWalletSecret: this.cdpConfig.walletSecret,
      walletName: params.walletName,
      paymasterUrl: this.getPaymasterUrl(params.testnet),
      id: params.subscriptionId,
      testnet: params.testnet,
    })

    return {
      transactionHash: result.id as Hash,
      success: result.success,
    }
  }

  validateSubscriptionId(id: string): boolean {
    return isHash(id)
  }

  /**
   * Translates Base SDK errors to domain HTTPError.
   * Classifies errors into:
   * - USER_OPERATION_FAILED: Bundler rejected userOp during simulation
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

    // USER OPERATION FAILED: UserOp was not submitted to blockchain
    // The bundler rejected the operation (typically after simulation check)
    // Common causes: duplicate charge, insufficient balance, nonce conflicts, gas failures
    // In batch processing, this prevents cascade duplication - don't create next order
    if (message.includes("user operation failed")) {
      return new HTTPError(
        409,
        ErrorCode.USER_OPERATION_FAILED,
        "User operation failed",
        { originalError: error.message },
      )
    }

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
