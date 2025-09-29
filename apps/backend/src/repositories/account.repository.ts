import { getAddress, type Address } from "viem"

export interface CreateAccountParams {
  evmAddress: Address
}

export interface RotateApiKeyParams {
  evmAddress: Address
  keyHash: string
}

export interface GetAccountParams {
  evmAddress: Address
}

export interface GetApiKeyParams {
  keyHash: string
}

export class AccountRepository {
  private db: D1Database

  constructor(deps: { db: D1Database }) {
    this.db = deps.db
  }

  /**
   * Creates a new account if it doesn't exist
   */
  async createAccount(params: CreateAccountParams): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO accounts (evm_address) VALUES (?)")
      .bind(params.evmAddress)
      .run()
  }

  /**
   * Rotates API key for an account (atomic operation)
   */
  async rotateApiKey(params: RotateApiKeyParams): Promise<void> {
    const statements = [
      // Delete existing API key for this account (if any)
      this.db
        .prepare("DELETE FROM api_keys WHERE evm_address = ?")
        .bind(params.evmAddress),

      // Insert new API key
      this.db
        .prepare("INSERT INTO api_keys (key_hash, evm_address) VALUES (?, ?)")
        .bind(params.keyHash, params.evmAddress),
    ]

    // Execute atomically
    await this.db.batch(statements)
  }

  /**
   * Gets account by EVM address
   */
  async getAccount(
    params: GetAccountParams,
  ): Promise<{ evm_address: Address } | null> {
    const result = await this.db
      .prepare("SELECT evm_address FROM accounts WHERE evm_address = ?")
      .bind(params.evmAddress)
      .first<{ evm_address: string }>()

    if (!result) {
      return null
    }

    return { evm_address: getAddress(result.evm_address) }
  }

  /**
   * Gets account by API key hash
   */
  async getAccountByApiKey(
    params: GetApiKeyParams,
  ): Promise<{ evm_address: Address } | null> {
    const result = await this.db
      .prepare("SELECT evm_address FROM api_keys WHERE key_hash = ?")
      .bind(params.keyHash)
      .first<{ evm_address: string }>()

    if (!result) {
      return null
    }

    return { evm_address: getAddress(result.evm_address) }
  }
}
