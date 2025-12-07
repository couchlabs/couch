import type { D1Database } from "@cloudflare/workers-types"
import * as schema from "@database/schema"
import { and, desc, eq, sql } from "drizzle-orm"
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

export interface GetApiKeyParams {
  keyHash: string
}

export class AccountRepository {
  private db: ReturnType<typeof drizzle<typeof schema>>
  private pendingUpdates: Set<Promise<void>> = new Set()

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
   * Wait for all pending background operations to complete
   * Useful for cleanup in tests
   */
  async waitForPendingUpdates(): Promise<void> {
    await Promise.all(this.pendingUpdates)
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
   * Gets account by API key hash
   * Checks that the key is enabled and updates last used timestamp
   */
  async getAccountByApiKey(params: GetApiKeyParams): Promise<Account | null> {
    const result = await this.db
      .select({
        id: schema.accounts.id,
        address: schema.accounts.address,
        keyEnabled: schema.apiKeys.enabled,
      })
      .from(schema.apiKeys)
      .innerJoin(
        schema.accounts,
        eq(schema.apiKeys.accountId, schema.accounts.id),
      )
      .where(eq(schema.apiKeys.keyHash, params.keyHash))
      .get()

    if (!result || !result.keyEnabled) {
      return null
    }

    // Update last used timestamp (async, don't block)
    const updatePromise = this.updateLastUsed(params.keyHash)
      .catch(console.error)
      .finally(() => {
        this.pendingUpdates.delete(updatePromise)
      })
    this.pendingUpdates.add(updatePromise)

    return this.toAccountDomain(result)
  }

  /**
   * Creates a new API key for an account
   */
  async createApiKey(params: {
    accountId: number
    keyHash: string
    name: string
    prefix: string
    start: string
    enabled?: boolean
  }): Promise<schema.ApiKey> {
    const result = await this.db
      .insert(schema.apiKeys)
      .values({
        accountId: params.accountId,
        keyHash: params.keyHash,
        name: params.name,
        prefix: params.prefix,
        start: params.start,
        enabled: params.enabled ?? true,
      })
      .returning()
      .get()

    return result as schema.ApiKey
  }

  /**
   * Lists all API keys for an account
   */
  async listApiKeys(params: { accountId: number }): Promise<schema.ApiKey[]> {
    const results = await this.db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.accountId, params.accountId))
      .orderBy(desc(schema.apiKeys.createdAt))
      .all()

    return results as schema.ApiKey[]
  }

  /**
   * Updates an API key (name and/or enabled status)
   */
  async updateApiKey(params: {
    id: number
    accountId: number
    name?: string
    enabled?: boolean
  }): Promise<schema.ApiKey | null> {
    const updates: Partial<typeof schema.apiKeys.$inferInsert> = {}
    if (params.name !== undefined) updates.name = params.name
    if (params.enabled !== undefined) updates.enabled = params.enabled

    if (Object.keys(updates).length === 0) {
      // No updates, just return current key
      return this.getApiKey({ id: params.id, accountId: params.accountId })
    }

    const result = await this.db
      .update(schema.apiKeys)
      .set(updates)
      .where(
        and(
          eq(schema.apiKeys.id, params.id),
          eq(schema.apiKeys.accountId, params.accountId),
        ),
      )
      .returning()
      .get()

    return result ? (result as schema.ApiKey) : null
  }

  /**
   * Deletes an API key (hard delete)
   */
  async deleteApiKey(params: {
    id: number
    accountId: number
  }): Promise<boolean> {
    const result = await this.db
      .delete(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.id, params.id),
          eq(schema.apiKeys.accountId, params.accountId),
        ),
      )
      .returning({ id: schema.apiKeys.id })
      .get()

    return result !== undefined
  }

  /**
   * Gets a single API key by ID and account
   */
  async getApiKey(params: {
    id: number
    accountId: number
  }): Promise<schema.ApiKey | null> {
    const result = await this.db
      .select()
      .from(schema.apiKeys)
      .where(
        and(
          eq(schema.apiKeys.id, params.id),
          eq(schema.apiKeys.accountId, params.accountId),
        ),
      )
      .get()

    return result ? (result as schema.ApiKey) : null
  }

  /**
   * Updates the last used timestamp for an API key
   */
  async updateLastUsed(keyHash: string): Promise<void> {
    await this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(schema.apiKeys.keyHash, keyHash))
      .run()
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
