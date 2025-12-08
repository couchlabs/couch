import { WorkerEntrypoint } from "cloudflare:workers"
import type { Queue } from "@cloudflare/workers-types"
import type { Address } from "viem"
import type { LoggingLevel } from "@/constants/env.constants"
import { AccountRepository } from "@/repositories/account.repository"
import type { ApiKeyResponse, CreateApiKeyResponse } from "@/rpc/types"
import { AccountService } from "@/services/account.service"
import { WebhookService } from "@/services/webhook.service"
import type { WebhookQueueMessage } from "../../alchemy.run"

interface BackendRPCEnv {
  DB: D1Database
  LOGGING: LoggingLevel
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  WEBHOOK_QUEUE: Queue<WebhookQueueMessage>
}

export class RPC extends WorkerEntrypoint<BackendRPCEnv> {
  /**
   * Helper: Get account by address (throws if not found)
   */
  private async getAccountByAddress(
    address: Address,
  ): Promise<{ id: number; address: Address }> {
    const accountRepo = new AccountRepository({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
    })

    const account = await accountRepo.getAccountByAddress(address)
    if (!account) {
      throw new Error("Account not found")
    }

    return account
  }

  /**
   * Gets or creates an account for the given EVM address
   * Skips allowlist check - trusted internal caller (merchant app)
   * Returns only success status - no sensitive data exposed
   */
  async getOrCreateAccount(params: {
    address: Address
  }): Promise<{ success: boolean }> {
    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    // Skip allowlist check - trusted internal caller
    return accountService.getOrCreateAccount({ address: params.address })
  }

  /**
   * Creates a new API key for an account
   * Returns the full key (one-time reveal) and metadata
   */
  async createApiKey(params: {
    accountAddress: Address
    name?: string
  }): Promise<CreateApiKeyResponse> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    return accountService.createApiKey({
      accountId: account.id,
      name: params.name,
    })
  }

  /**
   * Lists all API keys for an account (no secrets)
   */
  async listApiKeys(params: {
    accountAddress: Address
  }): Promise<ApiKeyResponse[]> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    return accountService.listApiKeys({ accountId: account.id })
  }

  /**
   * Updates an API key (name and/or enabled status)
   */
  async updateApiKey(params: {
    accountAddress: Address
    keyId: number
    name?: string
    enabled?: boolean
  }): Promise<ApiKeyResponse> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    return accountService.updateApiKey({
      accountId: account.id,
      keyId: params.keyId,
      name: params.name,
      enabled: params.enabled,
    })
  }

  /**
   * Deletes an API key (hard delete)
   */
  async deleteApiKey(params: {
    accountAddress: Address
    keyId: number
  }): Promise<{ success: boolean }> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    return accountService.deleteApiKey({
      accountId: account.id,
      keyId: params.keyId,
    })
  }

  /**
   * Creates or updates a webhook for an account
   * Returns the webhook secret for HMAC verification
   */
  async createWebhook(params: {
    accountAddress: Address
    url: string
  }): Promise<{ url: string; secret: string }> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const webhookService = new WebhookService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    return webhookService.setWebhook({
      accountId: account.id,
      url: params.url,
    })
  }

  /**
   * Gets webhook configuration for an account (safe - secret preview only)
   */
  async getWebhook(params: { accountAddress: Address }): Promise<{
    id: number
    url: string
    secretPreview: string
    enabled: boolean
    createdAt: string
    lastUsedAt?: string
  } | null> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const webhookService = new WebhookService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    return webhookService.getWebhook({
      accountId: account.id,
    })
  }

  /**
   * Updates webhook URL only (keeps existing secret)
   */
  async updateWebhookUrl(params: {
    accountAddress: Address
    url: string
  }): Promise<{ url: string }> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const webhookService = new WebhookService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    return webhookService.updateWebhookUrl({
      accountId: account.id,
      url: params.url,
    })
  }

  /**
   * Rotates webhook secret only (keeps existing URL)
   */
  async rotateWebhookSecret(params: {
    accountAddress: Address
  }): Promise<{ secret: string }> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const webhookService = new WebhookService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    return webhookService.rotateWebhookSecret({
      accountId: account.id,
    })
  }

  /**
   * Soft deletes webhook configuration
   */
  async deleteWebhook(params: {
    accountAddress: Address
  }): Promise<{ success: boolean }> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const webhookService = new WebhookService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    return webhookService.deleteWebhook({
      accountId: account.id,
    })
  }
}

export default RPC
