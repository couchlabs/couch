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
  account_address: Address
  url: string
  secret: string
}

export class WebhookRepository {
  private db: D1Database

  constructor(deps: { db: D1Database }) {
    this.db = deps.db
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
      .first<Webhook>()

    return result
  }
}
