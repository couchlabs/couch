import { getOrCreateSubscriptionOwnerWallet } from "@base-org/account/node"
import { type Address, getAddress, isAddress } from "viem"
import {
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_PREFIX,
  API_KEY_START_CHARS,
} from "@/constants/account.constants"
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
   * Wait for all pending background operations to complete
   * Useful for cleanup in tests
   */
  async waitForPendingUpdates(): Promise<void> {
    await this.accountRepository.waitForPendingUpdates()
  }

  /**
   * Generates a new API key with metadata for storage
   * Returns the full key (for one-time display) and metadata
   */
  private async generateApiKeyWithMetadata(): Promise<{
    apiKey: string
    keyHash: string
    start: string
    prefix: string
  }> {
    const prefix = API_KEY_PREFIX
    const secretPart = crypto.randomUUID().replace(/-/g, "")
    const apiKey = `${prefix}${secretPart}`
    const start = secretPart.slice(0, API_KEY_START_CHARS)

    // Hash only the secret part
    const encoder = new TextEncoder()
    const data = encoder.encode(secretPart)
    const hashBuffer = await crypto.subtle.digest("SHA-256", data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const keyHash = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    return { apiKey, keyHash, start, prefix }
  }

  /**
   * Hashes an API key for authentication
   * Strips the prefix and hashes only the secret part
   */
  private async hashApiKey(apiKey: string): Promise<string> {
    // Strip the prefix before hashing
    const secretPart = apiKey.startsWith(API_KEY_PREFIX)
      ? apiKey.slice(API_KEY_PREFIX.length)
      : apiKey

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
   * Creates a new API key for an account
   * Returns the full key (one-time reveal) and metadata
   * If no name is provided, generates "API Key N" where N is the count
   */
  async createApiKey(params: { accountId: number; name?: string }): Promise<{
    id: number
    apiKey: string
    name: string
    prefix: string
    start: string
    enabled: boolean
    createdAt: string
  }> {
    const log = logger.with({ accountId: params.accountId })

    // Validate name if provided
    if (params.name !== undefined && params.name.trim().length === 0) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "API key name cannot be empty",
      )
    }
    if (params.name && params.name.length > API_KEY_NAME_MAX_LENGTH) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        `API key name too long (max ${API_KEY_NAME_MAX_LENGTH} characters)`,
      )
    }

    // Generate default name if not provided
    let name: string
    if (params.name) {
      name = params.name.trim()
    } else {
      // Get current key count and generate "API Key N"
      const existingKeys = await this.accountRepository.listApiKeys({
        accountId: params.accountId,
      })
      const keyCount = existingKeys.length + 1
      name = `API Key ${keyCount}`
    }

    log.info("Creating new API key", { name })

    // Generate key with metadata
    const { apiKey, keyHash, start, prefix } =
      await this.generateApiKeyWithMetadata()

    // Store in database
    const createdKey = await this.accountRepository.createApiKey({
      accountId: params.accountId,
      keyHash,
      name,
      prefix,
      start,
      enabled: true,
    })

    log.info("API key created successfully", { keyId: createdKey.id })

    return {
      id: createdKey.id,
      apiKey, // ONLY time we return the full key
      name: createdKey.name,
      prefix: createdKey.prefix,
      start: createdKey.start,
      enabled: createdKey.enabled,
      createdAt: createdKey.createdAt,
    }
  }

  /**
   * Lists all API keys for an account (no secrets)
   */
  async listApiKeys(params: { accountId: number }): Promise<
    Array<{
      id: number
      name: string
      prefix: string
      start: string
      enabled: boolean
      createdAt: string
      lastUsedAt?: string
    }>
  > {
    const keys = await this.accountRepository.listApiKeys(params)

    // Map to safe response (exclude keyHash)
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      start: key.start,
      enabled: key.enabled,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt ?? undefined,
    }))
  }

  /**
   * Updates an API key (name and/or enabled status)
   */
  async updateApiKey(params: {
    accountId: number
    keyId: number
    name?: string
    enabled?: boolean
  }): Promise<{
    id: number
    name: string
    prefix: string
    start: string
    enabled: boolean
    createdAt: string
    lastUsedAt?: string
  }> {
    const log = logger.with({
      accountId: params.accountId,
      keyId: params.keyId,
    })

    // Validate name if provided
    if (params.name !== undefined) {
      if (params.name.trim().length === 0) {
        throw new HTTPError(
          400,
          ErrorCode.INVALID_FORMAT,
          "API key name cannot be empty",
        )
      }
      if (params.name.length > API_KEY_NAME_MAX_LENGTH) {
        throw new HTTPError(
          400,
          ErrorCode.INVALID_FORMAT,
          `API key name too long (max ${API_KEY_NAME_MAX_LENGTH} characters)`,
        )
      }
    }

    log.info("Updating API key", { name: params.name, enabled: params.enabled })

    const updatedKey = await this.accountRepository.updateApiKey({
      id: params.keyId,
      accountId: params.accountId,
      name: params.name?.trim(),
      enabled: params.enabled,
    })

    if (!updatedKey) {
      throw new HTTPError(404, ErrorCode.INVALID_REQUEST, "API key not found")
    }

    log.info("API key updated successfully")

    return {
      id: updatedKey.id,
      name: updatedKey.name,
      prefix: updatedKey.prefix,
      start: updatedKey.start,
      enabled: updatedKey.enabled,
      createdAt: updatedKey.createdAt,
      lastUsedAt: updatedKey.lastUsedAt ?? undefined,
    }
  }

  /**
   * Deletes an API key (hard delete)
   */
  async deleteApiKey(params: {
    accountId: number
    keyId: number
  }): Promise<{ success: boolean }> {
    const log = logger.with({
      accountId: params.accountId,
      keyId: params.keyId,
    })

    log.info("Deleting API key")

    const deleted = await this.accountRepository.deleteApiKey({
      id: params.keyId,
      accountId: params.accountId,
    })

    if (!deleted) {
      throw new HTTPError(404, ErrorCode.INVALID_REQUEST, "API key not found")
    }

    log.info("API key deleted successfully")

    return { success: true }
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
