import type { LoggingLevel } from "@backend/constants/env.constants"
import * as schema from "@backend/database/schema"
import { DrizzleLogger } from "@backend/lib/logger"
import type { D1Database } from "@cloudflare/workers-types"
import { and, eq, isNull } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"

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
   * Creates a new webhook for an account
   * If an active webhook exists, this will fail (unique constraint)
   * Caller should delete existing webhook first if they want to replace it
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
      .run()
  }

  /**
   * Updates an existing webhook's URL and/or secret
   * Only updates non-deleted webhooks
   */
  async updateWebhook(params: {
    accountId: number
    url?: string
    secret?: string
  }): Promise<void> {
    const updates: Partial<typeof schema.webhooks.$inferInsert> = {}
    if (params.url !== undefined) updates.url = params.url
    if (params.secret !== undefined) updates.secret = params.secret

    await this.db
      .update(schema.webhooks)
      .set(updates)
      .where(
        and(
          eq(schema.webhooks.accountId, params.accountId),
          isNull(schema.webhooks.deletedAt),
        ),
      )
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
      .set({
        deletedAt: new Date().toISOString(),
        enabled: false,
      })
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
}
