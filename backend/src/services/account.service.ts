import { getOrCreateSubscriptionOwnerWallet } from "@base-org/account/node"
import { type Address, getAddress, isAddress } from "viem"
import type { Network } from "@/constants/env.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { logger } from "@/lib/logger"
import { getSubscriptionOwnerWalletName } from "@/lib/subscription-owner-wallet"
import {
  type Account,
  AccountRepository,
  type AccountRepositoryDeps,
} from "@/repositories/account.repository"

export interface CreateAccountParams {
  address: string
}

export interface AccountResult {
  apiKey: string
  subscriptionOwnerWalletAddress: Address
}

export interface AccountServiceDeps extends AccountRepositoryDeps {
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  NETWORK: Network
  ALLOWLIST: {
    get: (key: string) => Promise<string | null>
  }
}

export class AccountService {
  private accountRepository: AccountRepository
  private network: Network
  private env: AccountServiceDeps

  constructor(env: AccountServiceDeps) {
    this.accountRepository = new AccountRepository(env)
    this.network = env.NETWORK
    this.env = env
  }

  /**
   * Generates a new API key with network-based prefix (ck_testnet_ or ck_mainnet_)
   * Returns both the full key and the hash of the secret part
   */
  private async generateApiKey(): Promise<{
    apiKey: string
    keyHash: string
  }> {
    const prefix = `ck_${this.network}_`
    const secretPart = crypto.randomUUID().replace(/-/g, "")
    const apiKey = `${prefix}${secretPart}`

    // Hash only the secret part
    const encoder = new TextEncoder()
    const data = encoder.encode(secretPart)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const keyHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    return { apiKey, keyHash }
  }

  /**
   * Hashes an API key for authentication
   * Strips the prefix and hashes only the secret part
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    // Strip the prefix before hashing
    const prefixMatch = apiKey.match(/^ck_[^_]+_(.+)$/)
    const secretPart = prefixMatch ? prefixMatch[1] : apiKey

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
   * Checks if an address is in the allowlist
   */
  async isAddressAllowed(address: Address): Promise<boolean> {
    const exists = await this.env.ALLOWLIST.get(address)
    return exists !== null
  }

  /**
   * Checks if an account already exists
   */
  async accountExists(address: Address): Promise<boolean> {
    const account = await this.accountRepository.getAccountByAddress(address)
    return account !== null
  }

  /**
   * Creates a new account (only if allowlisted and doesn't exist)
   */
  async createAccount(params: CreateAccountParams): Promise<AccountResult> {
    const accountAddress = this.validateAddress(params.address)
    const log = logger.with({ accountAddress })

    // Check if address is allowlisted
    const isAllowed = await this.isAddressAllowed(accountAddress)
    if (!isAllowed) {
      throw new HTTPError(
        403,
        ErrorCode.ADDRESS_NOT_ALLOWED,
        "Address not authorized for account creation",
      )
    }

    // Check if account already exists
    const exists = await this.accountExists(accountAddress)
    if (exists) {
      throw new HTTPError(
        409,
        ErrorCode.ACCOUNT_EXISTS,
        "Account already exists. Use /api/keys to manage API keys.",
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

    // Set API key
    const { apiKey, keyHash } = await this.generateApiKey()
    await this.accountRepository.setApiKey({
      accountId: account.id,
      keyHash,
    })

    log.info("Account created successfully", { accountId: account.id })

    return { apiKey, subscriptionOwnerWalletAddress }
  }

  /**
   * Rotates the API key for an authenticated account
   */
  async rotateApiKey(accountAddress: Address): Promise<AccountResult> {
    const log = logger.with({ accountAddress })

    log.info("Rotating account API key")

    // Get account to obtain ID
    const account =
      await this.accountRepository.getAccountByAddress(accountAddress)
    if (!account) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_REQUEST,
        "Account not found for this address",
      )
    }

    const { apiKey, keyHash } = await this.generateApiKey()

    // Set API key (atomic delete + insert)
    await this.accountRepository.setApiKey({
      accountId: account.id,
      keyHash,
    })

    // Get wallet address for this account
    const wallet = await getOrCreateSubscriptionOwnerWallet({
      cdpApiKeyId: this.env.CDP_API_KEY_ID,
      cdpApiKeySecret: this.env.CDP_API_KEY_SECRET,
      cdpWalletSecret: this.env.CDP_WALLET_SECRET,
      walletName: getSubscriptionOwnerWalletName(account.id),
    })

    log.info("Account API key rotated successfully")

    return { apiKey, subscriptionOwnerWalletAddress: wallet.address as Address }
  }

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
}
