import type { Hash } from "viem"

/**
 * Webhook event types for v1
 * Following spec: "Single event type with domain-aligned structure"
 */
export const WEBHOOK_EVENT_TYPE = "subscription.updated" as const

/**
 * Subscription status in webhook events
 */
export type SubscriptionStatus = "active" | "inactive" | "failed" | "canceled"

/**
 * Order types
 */
export type OrderType = "initial" | "recurring"

/**
 * Order status
 */
export type OrderStatus = "paid" | "failed"

/**
 * Subscription data in webhook event
 */
export interface WebhookSubscriptionData {
  id: Hash
  status: SubscriptionStatus
  current_period_end?: number // Unix timestamp, present if active
}

/**
 * Order data in webhook event (present if event relates to a payment)
 */
export interface WebhookOrderData {
  number: number // Sequential number relative to subscription
  type: OrderType
  amount: string
  status: OrderStatus
}

/**
 * Transaction data in webhook event (present if payment was successful)
 */
export interface WebhookTransactionData {
  hash: Hash
  amount: string
  processed_at: number // Unix timestamp
}

/**
 * Error data in webhook event (present if payment failed)
 */
export interface WebhookErrorData {
  code: string
  message: string
}

/**
 * Event data structure for subscription.updated
 */
export interface SubscriptionUpdatedEventData {
  subscription: WebhookSubscriptionData
  order?: WebhookOrderData
  transaction?: WebhookTransactionData
  error?: WebhookErrorData
}

/**
 * Complete webhook event structure
 */
export interface WebhookEvent {
  type: typeof WEBHOOK_EVENT_TYPE
  created_at: number // Unix timestamp
  data: SubscriptionUpdatedEventData
}
