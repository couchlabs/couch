import { env } from "cloudflare:workers"
import * as schema from "@database/schema"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import { type Address, getAddress } from "viem"
import { Stage } from "@/constants/env.constants"
import { DrizzleLogger } from "@/lib/logger"

// Re-export schema type
export type Account = schema.Account

// Custom parameter types
export interface CreateAccountParams {
  accountAddress: Address
}

export interface RotateApiKeyParams {
  accountAddress: Address
  keyHash: string
}

export interface GetApiKeyParams {
  keyHash: string
}

export class AccountRepository {
  private db: ReturnType<typeof drizzle<typeof schema>>

  constructor() {
    this.db = drizzle(env.DB, {
      schema,
      logger:
        env.STAGE === Stage.DEV || env.STAGE === Stage.STAGING
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
      address: getAddress(row.address),
    }
  }

  /**
   * Creates a new account if it doesn't exist
   */
  async createAccount(params: CreateAccountParams): Promise<void> {
    await this.db
      .insert(schema.accounts)
      .values({ address: params.accountAddress })
      .onConflictDoNothing()
      .run()
  }

  /**
   * Rotates API key for an account (atomic operation)
   */
  async rotateApiKey(params: RotateApiKeyParams): Promise<void> {
    await this.db.batch([
      // Delete existing API key for this account (if any)
      this.db
        .delete(schema.apiKeys)
        .where(eq(schema.apiKeys.accountAddress, params.accountAddress)),

      // Insert new API key
      this.db
        .insert(schema.apiKeys)
        .values({
          keyHash: params.keyHash,
          accountAddress: params.accountAddress,
        }),
    ])
  }

  /**
   * Gets account by API key hash
   */
  async getAccountByApiKey(params: GetApiKeyParams): Promise<Account | null> {
    const result = await this.db
      .select({ account_address: schema.apiKeys.accountAddress })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, params.keyHash))
      .get()

    if (!result) {
      return null
    }

    return this.toAccountDomain({ address: result.account_address })
  }
}
