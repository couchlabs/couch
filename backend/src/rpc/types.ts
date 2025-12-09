/**
 * Shared RPC types for API key and subscription operations
 * These types define the contract between merchant worker and backend RPC
 */

import type { Address, Hash } from "viem"
import type {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import type { Provider } from "@/providers/provider.interface"

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
 * Order response
 */
export interface OrderResponse {
  id: number
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
