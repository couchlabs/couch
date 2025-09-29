import { Stage } from "@/lib/constants"
import { isAddress, getAddress, type Address } from "viem"
import { AccountRepository } from "@/repositories/account.repository"
import { HTTPError, ErrorCode } from "@/api/errors"
import { logger } from "@/lib/logger"

export interface CreateOrRotateAccountParams {
  evmAddress: string
}

export interface AccountResult {
  apiKey: string
}

export class AccountService {
  private accountRepository: AccountRepository
  private stage: Stage

  constructor(deps: { accountRepository: AccountRepository; stage: Stage }) {
    this.accountRepository = deps.accountRepository
    this.stage = deps.stage
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
        "Invalid EVM address format",
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
    const evmAddress = this.validateAddress(params.evmAddress)
    const log = logger.with({ evmAddress })

    log.info("Creating or rotating account API key")

    const { apiKey, keyHash } = await this.generateApiKey()

    // Create account if it doesn't exist
    await this.accountRepository.createAccount({ evmAddress })

    // Rotate API key (atomic delete + insert)
    await this.accountRepository.rotateApiKey({
      evmAddress,
      keyHash,
    })

    log.info("Account API key rotated successfully")

    return { apiKey }
  }

  /**
   * Authenticates a request by validating the API key
   * Returns the associated EVM address if valid, null otherwise
   */
  async authenticateApiKey(apiKey: string): Promise<Address | null> {
    const keyHash = await this.hashApiKey(apiKey)

    const account = await this.accountRepository.getAccountByApiKey({
      keyHash,
    })

    return account?.evm_address || null
  }
}
