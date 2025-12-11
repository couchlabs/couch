import type { LoggingLevel } from "@backend/constants/env.constants"
import * as schema from "@backend/database/schema"
import { DrizzleLogger } from "@backend/lib/logger"
import type { D1Database } from "@cloudflare/workers-types"
import { and, desc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { type Address, getAddress } from "viem"

// Re-export schema type
export type Account = schema.Account

// Custom parameter types
export interface AccountRepositoryDeps {
  DB: D1Database
  LOGGING: LoggingLevel
}

export interface CreateAccountParams {
  accountAddress: Address
  cdpUserId?: string // Optional CDP user ID from JWT
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
      cdpUserId: row.cdpUserId ?? null,
      subscriptionOwnerAddress: row.subscriptionOwnerAddress
        ? getAddress(row.subscriptionOwnerAddress)
        : null,
      createdAt: row.createdAt,
    }
  }

  /**
   * Creates a new account and returns it with the auto-generated ID
   * @throws Error if account already exists (unique constraint violation)
   */
  async createAccount(params: CreateAccountParams): Promise<Account> {
    const result = await this.db
      .insert(schema.accounts)
      .values({
        address: params.accountAddress,
        cdpUserId: params.cdpUserId ?? null,
        subscriptionOwnerAddress: null,
      })
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
        cdpUserId: schema.accounts.cdpUserId,
        subscriptionOwnerAddress: schema.accounts.subscriptionOwnerAddress,
        createdAt: schema.accounts.createdAt,
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
   * Gets account by CDP user ID (from JWT 'sub' claim)
   */
  async getAccountByCdpUserId(cdpUserId: string): Promise<Account | null> {
    const result = await this.db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.cdpUserId, cdpUserId))
      .get()

    if (!result) {
      return null
    }

    return this.toAccountDomain(result)
  }

  /**
   * Updates the CDP user ID for an existing account
   */
  async updateCdpUserId(params: {
    accountId: number
    cdpUserId: string
  }): Promise<void> {
    await this.db
      .update(schema.accounts)
      .set({ cdpUserId: params.cdpUserId })
      .where(eq(schema.accounts.id, params.accountId))
      .run()
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

  /**
   * Updates the subscription owner address for an account
   */
  async updateAccountSubscriptionOwnerAddress(params: {
    id: number
    subscriptionOwnerAddress: Address
  }): Promise<Account> {
    const result = await this.db
      .update(schema.accounts)
      .set({
        subscriptionOwnerAddress: params.subscriptionOwnerAddress,
      })
      .where(eq(schema.accounts.id, params.id))
      .returning()
      .get()

    if (!result) {
      throw new Error(`Account ${params.id} not found`)
    }

    return this.toAccountDomain(result)
  }
}
