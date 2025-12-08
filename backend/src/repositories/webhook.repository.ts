import type { D1Database } from "@cloudflare/workers-types"
import * as schema from "@database/schema"
import { and, desc, eq, isNull } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import type { LoggingLevel } from "@/constants/env.constants"
import { DrizzleLogger } from "@/lib/logger"

// Re-export schema type
export type Webhook = schema.Webhook

// Custom parameter types
export interface WebhookRepositoryDeps {
  DB: D1Database
  LOGGING: LoggingLevel
}

export interface CreateOrUpdateWebhookParams {
  accountId: number
  url: string
  secret: string
}

export interface GetWebhookParams {
  accountId: number
}

export class WebhookRepository {
  private db: ReturnType<typeof drizzle<typeof schema>>

  constructor(deps: WebhookRepositoryDeps) {
    this.db = drizzle(deps.DB, {
      schema,
      logger:
        deps.LOGGING === "verbose"
          ? new DrizzleLogger("webhook.repository")
          : undefined,
    })
  }

  /**
   * Transform database row to domain type for Webhook (includes secret)
   */
  private toWebhookDomain(row: schema.WebhookRow): Webhook {
    return {
      id: row.id,
      accountId: row.accountId,
      url: row.url,
      secret: row.secret,
      enabled: row.enabled,
      deletedAt: row.deletedAt,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    }
  }

  /**
   * Creates or updates a webhook for an account (upsert)
   * Only one webhook per account in v1
   */
  async createOrUpdateWebhook(
    params: CreateOrUpdateWebhookParams,
  ): Promise<void> {
    await this.db
      .insert(schema.webhooks)
      .values({
        accountId: params.accountId,
        url: params.url,
        secret: params.secret,
      })
      .onConflictDoUpdate({
        target: schema.webhooks.accountId,
        set: {
          url: params.url,
          secret: params.secret,
        },
      })
      .run()
  }

  /**
   * Gets webhook configuration for an account (includes secret)
   * Use this for internal operations like sending webhooks
   */
  async getWebhook(params: GetWebhookParams): Promise<Webhook | null> {
    const result = await this.db
      .select()
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.accountId, params.accountId),
          isNull(schema.webhooks.deletedAt),
        ),
      )
      .get()

    if (!result) {
      return null
    }

    return this.toWebhookDomain(result)
  }

  /**
   * Soft deletes a webhook for an account (sets deletedAt timestamp)
   */
  async deleteWebhook(params: { accountId: number }): Promise<boolean> {
    const result = await this.db
      .update(schema.webhooks)
      .set({ deletedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.webhooks.accountId, params.accountId),
          isNull(schema.webhooks.deletedAt),
        ),
      )
      .returning({ id: schema.webhooks.id })
      .get()

    return result !== undefined
  }

  /**
   * Lists all active webhooks for an account (excludes soft-deleted)
   */
  async listWebhooks(params: { accountId: number }): Promise<Webhook[]> {
    const results = await this.db
      .select()
      .from(schema.webhooks)
      .where(
        and(
          eq(schema.webhooks.accountId, params.accountId),
          isNull(schema.webhooks.deletedAt),
        ),
      )
      .orderBy(desc(schema.webhooks.createdAt))
      .all()

    return results.map((row) => this.toWebhookDomain(row))
  }
}
