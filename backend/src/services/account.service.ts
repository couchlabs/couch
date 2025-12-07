import { getOrCreateSubscriptionOwnerWallet } from "@base-org/account/node"
import { type Address, getAddress, isAddress } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { logger } from "@/lib/logger"
import { getSubscriptionOwnerWalletName } from "@/lib/subscription-owner-wallet"
import {
  type Account,
  AccountRepository,
  type AccountRepositoryDeps,
} from "@/repositories/account.repository"

export interface CreateAccountParams {
  address: Address
}

export interface AccountResult {
  subscriptionOwnerWalletAddress: Address
}

export interface RotateApiKeyResult {
  apiKey: string
  subscriptionOwnerWalletAddress: Address
}

export interface AccountServiceDeps extends AccountRepositoryDeps {
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
}

export class AccountService {
  private accountRepository: AccountRepository
  private env: AccountServiceDeps

  constructor(env: AccountServiceDeps) {
    this.accountRepository = new AccountRepository(env)
    this.env = env
  }

  /**
   * DEPRECATED: Will be replaced with generateApiKeyWithMetadata() in Phase 3
   * Generates a new API key with prefix ck_
   * Returns both the full key and the hash of the secret part
   */
  // private async generateApiKey(): Promise<{
  //   apiKey: string
  //   keyHash: string
  // }> {
  //   const prefix = "ck_"
  //   const secretPart = crypto.randomUUID().replace(/-/g, "")
  //   const apiKey = `${prefix}${secretPart}`

  //   // Hash only the secret part
  //   const encoder = new TextEncoder()
  //   const data = encoder.encode(secretPart)
  //   const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  //   const hashArray = Array.from(new Uint8Array(hashBuffer))
  //   const keyHash = hashArray
  //     .map((b) => b.toString(16).padStart(2, "0"))
  //     .join("")

  //   return { apiKey, keyHash }
  // }

  /**
   * Hashes an API key for authentication
   * Strips the prefix and hashes only the secret part
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    // Strip the "ck_" prefix before hashing
    const secretPart = apiKey.startsWith("ck_") ? apiKey.slice(3) : apiKey

    const encoder = new TextEncoder()
    const data = encoder.encode(secretPart)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
  }

  /**
   * Validates and normalizes an EVM address
   */
  private validateAddress(address: string): Address {
    if (!isAddress(address)) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Invalid address format",
      )
    }
    return getAddress(address) // Returns checksummed address
  }

  /**
   * Checks if an account already exists
   */
  async accountExists(address: Address): Promise<boolean> {
    const account = await this.accountRepository.getAccountByAddress(address)
    return account !== null
  }

  /**
   * Creates a new account
   * Note: Authentication is handled by CDP at the merchant app level
   * API keys will be managed separately via API key CRUD operations
   * Note: Caller is responsible for address validation (already done in getOrCreateAccount)
   */
  async createAccount(params: CreateAccountParams): Promise<AccountResult> {
    const accountAddress = params.address
    const log = logger.with({ accountAddress })

    // Check if account already exists
    const exists = await this.accountExists(accountAddress)
    if (exists) {
      throw new HTTPError(
        409,
        ErrorCode.ACCOUNT_EXISTS,
        "Account already exists",
      )
    }

    log.info("Creating new account")

    // Create account in DB - returns account with auto-generated ID
    const account = await this.accountRepository.createAccount({
      accountAddress,
    })

    // Create subscription owner wallet for this account
    let subscriptionOwnerWalletAddress: Address
    try {
      const walletName = getSubscriptionOwnerWalletName(account.id)

      const wallet = await getOrCreateSubscriptionOwnerWallet({
        cdpApiKeyId: this.env.CDP_API_KEY_ID,
        cdpApiKeySecret: this.env.CDP_API_KEY_SECRET,
        cdpWalletSecret: this.env.CDP_WALLET_SECRET,
        walletName,
      })

      subscriptionOwnerWalletAddress = wallet.address as Address
      log.info("Created subscription owner wallet", {
        accountId: account.id,
        walletAddress: subscriptionOwnerWalletAddress,
        walletName,
      })
    } catch (error) {
      // Rollback account creation if wallet creation fails
      log.error("Failed to create subscription owner wallet - rolling back", {
        error,
        accountId: account.id,
      })

      // Delete the account we just created
      await this.accountRepository.deleteAccount(account.id)

      throw new HTTPError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "Failed to create subscription owner wallet",
      )
    }

    log.info("Account created successfully", { accountId: account.id })

    return { subscriptionOwnerWalletAddress }
  }

  /**
   * DEPRECATED: Will be removed in Phase 8
   * Rotates the API key for an authenticated account
   */
  // async rotateApiKey(accountId: number): Promise<RotateApiKeyResult> {
  //   const log = logger.with({ accountId })

  //   log.info("Rotating account API key")

  //   const { apiKey, keyHash } = await this.generateApiKey()

  //   // Set API key (atomic delete + insert)
  //   await this.accountRepository.setApiKey({
  //     accountId,
  //     keyHash,
  //   })

  //   // Get wallet address for this account
  //   const wallet = await getOrCreateSubscriptionOwnerWallet({
  //     cdpApiKeyId: this.env.CDP_API_KEY_ID,
  //     cdpApiKeySecret: this.env.CDP_API_KEY_SECRET,
  //     cdpWalletSecret: this.env.CDP_WALLET_SECRET,
  //     walletName: getSubscriptionOwnerWalletName(accountId),
  //   })

  //   log.info("Account API key rotated successfully")

  //   return { apiKey, subscriptionOwnerWalletAddress: wallet.address as Address }
  // }

  /**
   * Authenticates a request by validating the API key
   * Returns the associated account (with id and address) if valid
   * Throws HTTPError if invalid
   */
  async authenticateApiKey(apiKey: string): Promise<Account> {
    const keyHash = await this.hashApiKey(apiKey)

    const account = await this.accountRepository.getAccountByApiKey({
      keyHash,
    })

    if (!account) {
      throw new HTTPError(401, ErrorCode.INVALID_API_KEY, "Invalid API key")
    }

    return account
  }

  /**
   * Gets or creates an account (for internal RPC use)
   * Returns success status only - no sensitive data
   * Authentication is handled by CDP at the merchant app level
   */
  async getOrCreateAccount(params: {
    address: string
  }): Promise<{ success: boolean }> {
    const accountAddress = this.validateAddress(params.address)
    const log = logger.with({ accountAddress })

    // Check if account exists
    const existing =
      await this.accountRepository.getAccountByAddress(accountAddress)
    if (existing) {
      log.info("Account already exists")
      return { success: true }
    }

    log.info("Creating new account via RPC")
    await this.createAccount({ address: accountAddress })

    return { success: true }
  }
}
