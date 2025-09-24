import { base, ChargeResult } from "@base-org/account"
import {
  fetchPermission,
  prepareRevokeCallData,
} from "@base-org/account/spend-permission"
import { CdpClient, type EvmSmartAccount } from "@coinbase/cdp-sdk"

import { logger } from "../lib/logger"
import { OnchainErrors } from "./onchain.repository.errors"

export interface CdpConfig {
  apiKeyId: string
  apiKeySecret: string
  walletSecret: string
  walletName: string
  paymasterUrl: string
}

export interface OnchainRepositoryConfig {
  cdpConfig: CdpConfig
  testnet: boolean
}

export interface OnchainRepositoryConstructorParams {
  config: OnchainRepositoryConfig
  smartAccount: EvmSmartAccount
}

export interface ChargeSubscriptionParams {
  subscriptionId: string
  amount: string
}

export interface RevokeSubscriptionParams {
  subscriptionId: string
}

export interface GetSubscriptionStatusParams {
  subscriptionId: string
}

export interface SubscriptionStatusResult {
  subscription: {
    isSubscribed: boolean
    subscriptionOwner?: `0x${string}` // Ethereum address
    remainingChargeInPeriod?: string
    nextPeriodStart?: Date
    recurringCharge?: string
  }
  context: {
    smartAccountAddress: `0x${string}` // Ethereum address
  }
}

export class OnchainRepository {
  private smartAccount: EvmSmartAccount
  private cdp: CdpConfig
  private testnet: boolean
  private network: "base" | "base-sepolia"

  private constructor(params: OnchainRepositoryConstructorParams) {
    this.cdp = params.config.cdpConfig
    this.testnet = params.config.testnet
    this.network = params.config.testnet ? "base-sepolia" : "base"
    this.smartAccount = params.smartAccount
  }

  static async create(
    config: OnchainRepositoryConfig,
  ): Promise<OnchainRepository> {
    const { cdpConfig, testnet } = config
    const network = testnet ? "base-sepolia" : "base"

    const cdp = new CdpClient({
      apiKeyId: cdpConfig.apiKeyId,
      apiKeySecret: cdpConfig.apiKeySecret,
      walletSecret: cdpConfig.walletSecret,
    })

    const eoaAccount = await cdp.evm.getAccount({
      name: cdpConfig.walletName,
    })

    if (!eoaAccount) {
      throw OnchainErrors.eoaWalletNotFound(cdpConfig.walletName)
    }

    const smartAccount = await cdp.evm.getSmartAccount({
      owner: eoaAccount,
      name: cdpConfig.walletName,
    })

    if (!smartAccount) {
      throw OnchainErrors.smartWalletNotFound(cdpConfig.walletName)
    }

    logger.info("OnchainRepository initialized", {
      smartAccountAddress: smartAccount.address,
      smartAccountName: smartAccount.name,
      network,
      testnet,
    })

    return new OnchainRepository({ config, smartAccount })
  }

  async chargeSubscription(
    params: ChargeSubscriptionParams,
  ): Promise<ChargeResult> {
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

      log.info("Onchain charge successful", {
        transactionHash: transaction.id,
        amount: transaction.amount,
      })

      return transaction
    } catch (error) {
      log.error("Onchain charge failed", error)
      throw error
    }
  }

  async revokePermission(params: RevokeSubscriptionParams): Promise<{
    success: boolean
    transactionHash?: string
    error?: any
  }> {
    const { subscriptionId } = params
    const log = logger.with({ subscriptionId })

    try {
      log.info("Starting onchain permission revocation")

      const permissionToRevoke = await fetchPermission({
        permissionHash: subscriptionId,
      })
      const revokeCall = await prepareRevokeCallData(permissionToRevoke)

      // Convert the revoke call to the expected format
      // Using 'any' to bypass TypeScript's deep instantiation issue with CDP SDK types
      const userOpResult = await this.smartAccount.sendUserOperation({
        paymasterUrl: this.cdp.paymasterUrl,
        network: this.network,
        calls: [revokeCall],
      } as any)

      log.info("Revoke operation broadcast", {
        userOpHash: userOpResult.userOpHash,
      })

      // Wait for the operation to complete and get the transaction hash (default to 10 seconds waitOptions)
      const completedOp = await this.smartAccount.waitForUserOperation({
        userOpHash: userOpResult.userOpHash,
      })

      // Check if the operation was successful
      if (completedOp.status === "failed") {
        throw OnchainErrors.userOperationFailed(
          userOpResult.userOpHash,
          "revoke",
        )
      }

      log.info("Permission successfully revoked onchain", {
        transactionHash: completedOp.transactionHash,
      })

      return {
        success: true,
        transactionHash: completedOp.transactionHash,
      }
    } catch (error) {
      log.warn("Onchain revocation failed", {
        message: error?.message || "Unknown error",
      })

      return {
        success: false,
        error: {
          message: error?.message || "Unknown error",
          name: error?.name,
        },
      }
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
          | `0x${string}`
          | undefined,
      },
      context: {
        smartAccountAddress: this.smartAccount.address as `0x${string}`,
      },
    }
  }
}
