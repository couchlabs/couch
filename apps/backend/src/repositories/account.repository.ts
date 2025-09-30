import { type Address, getAddress } from "viem"

export interface CreateAccountParams {
  accountAddress: Address
}

export interface RotateApiKeyParams {
  accountAddress: Address
  keyHash: string
}

export interface GetAccountParams {
  address: Address
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
      .prepare("INSERT OR IGNORE INTO accounts (address) VALUES (?)")
      .bind(params.accountAddress)
      .run()
  }

  /**
   * Rotates API key for an account (atomic operation)
   */
  async rotateApiKey(params: RotateApiKeyParams): Promise<void> {
    const statements = [
      // Delete existing API key for this account (if any)
      this.db
        .prepare("DELETE FROM api_keys WHERE account_address = ?")
        .bind(params.accountAddress),

      // Insert new API key
      this.db
        .prepare(
          "INSERT INTO api_keys (key_hash, account_address) VALUES (?, ?)",
        )
        .bind(params.keyHash, params.accountAddress),
    ]

    // Execute atomically
    await this.db.batch(statements)
  }

  /**
   * Gets account by address
   */
  async getAccount(
    params: GetAccountParams,
  ): Promise<{ address: Address } | null> {
    const result = await this.db
      .prepare("SELECT address FROM accounts WHERE address = ?")
      .bind(params.address)
      .first<{ address: string }>()

    if (!result) {
      return null
    }

    return { address: getAddress(result.address) }
  }

  /**
   * Gets account by API key hash
   */
  async getAccountByApiKey(
    params: GetApiKeyParams,
  ): Promise<{ address: Address } | null> {
    const result = await this.db
      .prepare("SELECT account_address FROM api_keys WHERE key_hash = ?")
      .bind(params.keyHash)
      .first<{ account_address: string }>()

    if (!result) {
      return null
    }

    return { address: getAddress(result.account_address) }
  }
}
