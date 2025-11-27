import type { D1Database } from "@cloudflare/workers-types"
import * as schema from "@database/schema"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { type Address, getAddress } from "viem"
import type { LoggingLevel } from "@/constants/env.constants"
import { DrizzleLogger } from "@/lib/logger"

// Re-export schema type
export type Account = schema.Account

// Custom parameter types
export interface AccountRepositoryDeps {
  DB: D1Database
  LOGGING: LoggingLevel
}

export interface CreateAccountParams {
  accountAddress: Address
}

export interface SetApiKeyParams {
  accountId: number
  keyHash: string
}

export interface GetApiKeyParams {
  keyHash: string
}

export class AccountRepository {
  private db: ReturnType<typeof drizzle<typeof schema>>

  constructor(deps: AccountRepositoryDeps) {
    this.db = drizzle(deps.DB, {
      schema,
      logger:
        deps.LOGGING === "verbose"
          ? new DrizzleLogger("account.repository")
          : undefined,
    })
  }

  /**
   * Transform database row to domain type for Account
   * Uses getAddress() to ensure checksummed address
   */
  private toAccountDomain(row: schema.AccountRow): Account {
    return {
      id: row.id,
      address: getAddress(row.address),
    }
  }

  /**
   * Creates a new account and returns it with the auto-generated ID
   * @throws Error if account already exists (unique constraint violation)
   */
  async createAccount(params: CreateAccountParams): Promise<Account> {
    const result = await this.db
      .insert(schema.accounts)
      .values({ address: params.accountAddress })
      .returning()
      .get()

    return this.toAccountDomain(result)
  }

  /**
   * Sets API key for an account (atomic operation)
   * Deletes any existing keys and inserts the new one
   * Works for both initial creation and rotation
   */
  async setApiKey(params: SetApiKeyParams): Promise<void> {
    await this.db.batch([
      // Delete existing API key for this account (if any)
      this.db
        .delete(schema.apiKeys)
        .where(eq(schema.apiKeys.accountId, params.accountId)),

      // Insert new API key
      this.db
        .insert(schema.apiKeys)
        .values({
          keyHash: params.keyHash,
          accountId: params.accountId,
        }),
    ])
  }

  /**
   * Gets account by API key hash
   */
  async getAccountByApiKey(params: GetApiKeyParams): Promise<Account | null> {
    const result = await this.db
      .select({
        id: schema.accounts.id,
        address: schema.accounts.address,
      })
      .from(schema.apiKeys)
      .innerJoin(
        schema.accounts,
        eq(schema.apiKeys.accountId, schema.accounts.id),
      )
      .where(eq(schema.apiKeys.keyHash, params.keyHash))
      .get()

    if (!result) {
      return null
    }

    return this.toAccountDomain(result)
  }

  /**
   * Gets account by address
   */
  async getAccountByAddress(address: Address): Promise<Account | null> {
    const result = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.address, address))
      .get()

    if (!result) {
      return null
    }

    return this.toAccountDomain(result)
  }

  /**
   * Deletes an account by ID
   * Also deletes related API keys and webhooks via cascade
   */
  async deleteAccount(accountId: number): Promise<void> {
    await this.db
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .run()
  }
}
