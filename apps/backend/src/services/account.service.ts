import { env } from "cloudflare:workers"
import { type Address, getAddress, isAddress } from "viem"
import type { Stage } from "@/constants/env.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { logger } from "@/lib/logger"
import { AccountRepository } from "@/repositories/account.repository"

export interface CreateOrRotateAccountParams {
  address: string
}

export interface AccountResult {
  apiKey: string
}

export class AccountService {
  private accountRepository: AccountRepository
  private stage: Stage

  constructor() {
    this.accountRepository = new AccountRepository()
    this.stage = env.STAGE
  }

  /**
   * Generates a new API key with stage-based prefix
   * Returns both the full key and the hash of the secret part
   */
  private async generateApiKey(): Promise<{
    apiKey: string
    keyHash: string
  }> {
    const prefix = `ck_${this.stage}_`
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
   * Creates a new account or rotates the API key for an existing account
   */
  async createOrRotateAccount(
    params: CreateOrRotateAccountParams,
  ): Promise<AccountResult> {
    const accountAddress = this.validateAddress(params.address)
    const log = logger.with({ accountAddress })

    log.info("Creating or rotating account API key")

    const { apiKey, keyHash } = await this.generateApiKey()

    // Create account if it doesn't exist
    await this.accountRepository.createAccount({ accountAddress })

    // Rotate API key (atomic delete + insert)
    await this.accountRepository.rotateApiKey({
      accountAddress,
      keyHash,
    })

    log.info("Account API key rotated successfully")

    return { apiKey }
  }

  /**
   * Authenticates a request by validating the API key
   * Returns the associated account address if valid
   * Throws HTTPError if invalid
   */
  async authenticateApiKey(apiKey: string): Promise<Address> {
    const keyHash = await this.hashApiKey(apiKey)

    const account = await this.accountRepository.getAccountByApiKey({
      keyHash,
    })

    if (!account) {
      throw new HTTPError(401, ErrorCode.INVALID_API_KEY, "Invalid API key")
    }

    return account.address
  }
}
