import { WorkerEntrypoint } from "cloudflare:workers"
import type { Address, Hash } from "viem"
import type {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import type { Provider } from "@/providers/provider.interface"
import {
  type Account,
  AccountRepository,
} from "@/repositories/account.repository"
import { AccountService } from "@/services/account.service"
import { SubscriptionService } from "@/services/subscription.service"
import { WebhookService } from "@/services/webhook.service"
import type { ApiWorkerEnv } from "@/types/api.env"

// =============================================================================
// RPC Response Types
// These types define the contract between merchant worker and backend RPC
// =============================================================================

/**
 * Account response (public view - no internal ID)
 */
export interface AccountResponse {
  address: Address
  subscriptionOwnerAddress: Address | null
  createdAt: string
}

/**
 * API Key response (safe for client - no secrets)
 */
export interface ApiKeyResponse {
  id: number
  name: string
  prefix: string
  start: string
  enabled: boolean
  createdAt: string
  lastUsedAt?: string
}

/**
 * Create API Key response (includes full key one-time only)
 */
export interface CreateApiKeyResponse extends ApiKeyResponse {
  apiKey: string // Full key - only returned on creation
}

/**
 * Webhook response (public view - no internal ID)
 */
export interface WebhookResponse {
  url: string
  secretPreview: string
  enabled: boolean
  createdAt: string
  lastUsedAt?: string
}

/**
 * Create webhook response (includes full secret one-time only)
 */
export interface CreateWebhookResponse {
  url: string
  secret: string
}

/**
 * Subscription response (list view)
 */
export interface SubscriptionResponse {
  subscriptionId: Hash
  status: SubscriptionStatus
  beneficiaryAddress: Address
  provider: Provider
  testnet: boolean
  createdAt: string
  modifiedAt: string
}

/**
 * Order response (no internal ID)
 */
export interface OrderResponse {
  type: OrderType
  dueAt: string
  amount: string
  status: OrderStatus
  orderNumber: number
  attempts: number
  periodLengthInSeconds: number
  transactionHash?: Hash
  failureReason?: string
  createdAt: string
}

/**
 * Subscription detail response (includes orders)
 */
export interface SubscriptionDetailResponse {
  subscription: SubscriptionResponse
  orders: OrderResponse[]
}

/**
 * Generic success response
 */
export interface SuccessResponse {
  success: boolean
}

export class RPC extends WorkerEntrypoint<ApiWorkerEnv> {
  /**
   * Helper: Get account by address (throws if not found)
   * Returns full Account for internal use (includes id for database operations)
   */
  private async getAccountByAddress(address: Address): Promise<Account> {
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
   * Returns account data including subscription owner address
   */
  async getOrCreateAccount(params: {
    address: Address
  }): Promise<AccountResponse> {
    const accountService = new AccountService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
    })

    const account = await accountService.getOrCreateAccount({
      address: params.address,
    })

    return {
      address: account.address,
      subscriptionOwnerAddress: account.subscriptionOwnerAddress,
      createdAt: account.createdAt,
    }
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
  }): Promise<SuccessResponse> {
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
  }): Promise<CreateWebhookResponse> {
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
  async getWebhook(params: {
    accountAddress: Address
  }): Promise<WebhookResponse | null> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const webhookService = new WebhookService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    const webhook = await webhookService.getWebhook({
      accountId: account.id,
    })

    if (!webhook) {
      return null
    }

    // Strip internal ID from response
    return {
      url: webhook.url,
      secretPreview: webhook.secretPreview,
      enabled: webhook.enabled,
      createdAt: webhook.createdAt,
      lastUsedAt: webhook.lastUsedAt,
    }
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
  }): Promise<SuccessResponse> {
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

  /**
   * Lists all subscriptions for an account
   * Optionally filters by network (testnet vs mainnet)
   */
  async listSubscriptions(params: {
    accountAddress: Address
    testnet?: boolean
  }): Promise<SubscriptionResponse[]> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const subscriptionService = new SubscriptionService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
      CDP_CLIENT_API_KEY: this.env.CDP_CLIENT_API_KEY,
      ORDER_SCHEDULER: this.env.ORDER_SCHEDULER,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    const subscriptions = await subscriptionService.listSubscriptions({
      accountId: account.id,
      testnet: params.testnet,
    })

    // Transform to RPC response format (strip accountId)
    return subscriptions.map((sub) => ({
      subscriptionId: sub.subscriptionId,
      status: sub.status,
      beneficiaryAddress: sub.beneficiaryAddress,
      provider: sub.provider,
      testnet: sub.testnet,
      createdAt: sub.createdAt || "",
      modifiedAt: sub.modifiedAt || "",
    }))
  }

  /**
   * Gets subscription details with all orders
   * Returns null if subscription not found or doesn't belong to account
   */
  async getSubscription(params: {
    accountAddress: Address
    subscriptionId: Hash
  }): Promise<SubscriptionDetailResponse | null> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const subscriptionService = new SubscriptionService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
      CDP_CLIENT_API_KEY: this.env.CDP_CLIENT_API_KEY,
      ORDER_SCHEDULER: this.env.ORDER_SCHEDULER,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    const result = await subscriptionService.getSubscriptionWithOrders({
      subscriptionId: params.subscriptionId,
      accountId: account.id,
    })

    if (!result) {
      return null
    }

    // Transform to RPC response format
    const subscription: SubscriptionResponse = {
      subscriptionId: result.subscription.subscriptionId,
      status: result.subscription.status,
      beneficiaryAddress: result.subscription.beneficiaryAddress,
      provider: result.subscription.provider,
      testnet: result.subscription.testnet,
      createdAt: result.subscription.createdAt || "",
      modifiedAt: result.subscription.modifiedAt || "",
    }

    const orders: OrderResponse[] = result.orders.map((order) => ({
      type: order.type,
      dueAt: order.dueAt,
      amount: order.amount,
      status: order.status,
      orderNumber: order.orderNumber,
      attempts: order.attempts,
      periodLengthInSeconds: order.periodLengthInSeconds,
      transactionHash: order.transactionHash,
      failureReason: order.failureReason || undefined,
      createdAt: order.createdAt || "",
    }))

    return { subscription, orders }
  }

  /**
   * Revokes a subscription (immediate cancellation)
   * Handles onchain revocation and database updates
   */
  async revokeSubscription(params: {
    accountAddress: Address
    subscriptionId: Hash
  }): Promise<SuccessResponse> {
    const account = await this.getAccountByAddress(params.accountAddress)

    const subscriptionService = new SubscriptionService({
      DB: this.env.DB,
      LOGGING: this.env.LOGGING,
      CDP_API_KEY_ID: this.env.CDP_API_KEY_ID,
      CDP_API_KEY_SECRET: this.env.CDP_API_KEY_SECRET,
      CDP_WALLET_SECRET: this.env.CDP_WALLET_SECRET,
      CDP_CLIENT_API_KEY: this.env.CDP_CLIENT_API_KEY,
      ORDER_SCHEDULER: this.env.ORDER_SCHEDULER,
      WEBHOOK_QUEUE: this.env.WEBHOOK_QUEUE,
    })

    await subscriptionService.revokeSubscription({
      subscriptionId: params.subscriptionId,
      accountId: account.id,
    })

    return { success: true }
  }
}

export default RPC
