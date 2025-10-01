import { env } from "cloudflare:workers"
import type { D1Database } from "@cloudflare/workers-types"
import type { Address } from "viem"

export interface CreateOrUpdateWebhookParams {
  accountAddress: Address
  url: string
  secret: string
}

export interface GetWebhookParams {
  accountAddress: Address
}

export interface Webhook {
  accountAddress: Address
  url: string
  secret: string
}

export class WebhookRepository {
  private db: D1Database

  constructor() {
    this.db = env.DB
  }

  /**
   * Creates or updates a webhook for an account (upsert)
   * Only one webhook per account in v1
   */
  async createOrUpdateWebhook(
    params: CreateOrUpdateWebhookParams,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhooks (account_address, url, secret)
         VALUES (?, ?, ?)
         ON CONFLICT(account_address)
         DO UPDATE SET url = ?, secret = ?`,
      )
      .bind(
        params.accountAddress,
        params.url,
        params.secret,
        params.url,
        params.secret,
      )
      .run()
  }

  /**
   * Gets webhook configuration for an account
   */
  async getWebhook(params: GetWebhookParams): Promise<Webhook | null> {
    const result = await this.db
      .prepare(
        "SELECT account_address, url, secret FROM webhooks WHERE account_address = ?",
      )
      .bind(params.accountAddress)
      .first<{ account_address: string; url: string; secret: string }>()

    if (!result) {
      return null
    }

    return {
      accountAddress: result.account_address as Address,
      url: result.url,
      secret: result.secret,
    }
  }
}
