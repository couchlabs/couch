import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type { Address, Hash } from "viem"
import { API_KEY_PREFIX } from "@/constants/account.constants"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { Provider } from "@/providers/provider.interface"

// =============================================================================
// HELPERS FOR CHECK CONSTRAINTS
// =============================================================================

// Generate CHECK constraint values from enums (single source of truth)
const subscriptionStatusValues = Object.values(SubscriptionStatus)
  .map((s) => `'${s}'`)
  .join(", ")
const orderStatusValues = Object.values(OrderStatus)
  .map((s) => `'${s}'`)
  .join(", ")
const orderTypeValues = Object.values(OrderType)
  .map((s) => `'${s}'`)
  .join(", ")
const providerValues = Object.values(Provider)
  .map((p) => `'${p}'`)
  .join(", ")

// =============================================================================
// ACCOUNT TABLES
// =============================================================================

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  address: text("address").unique().notNull(),
  subscriptionOwnerAddress: text("subscription_owner_address"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
})

// API Keys - SHA-256 hash of the secret part (no prefix)
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    keyHash: text("key_hash").notNull().unique(),
    // Account that owns this apikey
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull().default(API_KEY_PREFIX),
    start: text("start").notNull(), // First N chars for UI preview
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
    expiresAt: text("expires_at"),
  },
  (table) => [
    index("idx_api_keys_hash").on(table.keyHash),
    index("idx_api_keys_account").on(table.accountId),
  ],
)

// Webhooks - event delivery configuration with HMAC verification
export const webhooks = sqliteTable(
  "webhooks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
  },
  (table) => [
    index("idx_webhooks_account").on(table.accountId),
    // V1: Enforce single active webhook per account (allows soft-deleted webhooks to remain)
    uniqueIndex("idx_webhooks_account_active_unique")
      .on(table.accountId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)

// =============================================================================
// SUBSCRIPTION TABLES
// =============================================================================

// Core subscription state (minimal - onchain is source of truth)
// subscription_id: This IS the permission hash from onchain
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    subscriptionId: text("subscription_id").primaryKey(),
    status: text("status").$type<SubscriptionStatus>().notNull(),
    // Account that owns this subscription
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    // Who receives payments
    beneficiaryAddress: text("beneficiary_address").notNull(),
    provider: text("provider").$type<Provider>().notNull(),
    // Network flag: false = mainnet (ie Base), true = testnet (ie Base Sepolia)
    testnet: integer("testnet", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    modifiedAt: text("modified_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_subscriptions_account").on(table.accountId),
    index("idx_subscriptions_beneficiary").on(table.beneficiaryAddress),
    index("idx_subscriptions_status").on(table.status),
    index("idx_subscriptions_created").on(table.createdAt),
    check("status", sql.raw(`status IN (${subscriptionStatusValues})`)),
    check("provider", sql.raw(`provider IN (${providerValues})`)),
  ],
)

// Orders - individual charges for subscriptions
// amount: In USDC base units
// parentOrderId: Links retry orders to original failed order
// nextRetryAt: For retry orders - when to attempt next retry
// failureReason: Mapped error code (e.g., 'INSUFFICIENT_SPENDING_ALLOWANCE', 'PERMISSION_EXPIRED')
// rawError: Original error message from blockchain/service for debugging
// periodLengthInSeconds: Duration of billing period (period_start = due_at, period_end = due_at + period_length_in_seconds)
// transactionHash: Blockchain transaction hash for successful payments
export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.subscriptionId),
    type: text("type").$type<OrderType>().notNull(),
    dueAt: text("due_at").notNull(),
    amount: text("amount").notNull(),
    status: text("status").$type<OrderStatus>().notNull(),
    orderNumber: integer("order_number").notNull(),
    attempts: integer("attempts").notNull().default(0),
    parentOrderId: integer("parent_order_id"),
    nextRetryAt: text("next_retry_at"),
    failureReason: text("failure_reason"),
    rawError: text("raw_error"),
    periodLengthInSeconds: integer("period_length_in_seconds").notNull(),
    transactionHash: text("transaction_hash"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_orders_created").on(table.createdAt),
    index("idx_orders_due_status").on(table.dueAt, table.status),
    index("idx_orders_subscription").on(table.subscriptionId),
    index("idx_orders_parent").on(table.parentOrderId),
    index("idx_orders_status").on(table.status),
    index("idx_orders_retry_due")
      .on(table.nextRetryAt, table.status)
      .where(sql`${table.nextRetryAt} IS NOT NULL`),
    index("idx_orders_subscription_number").on(
      table.subscriptionId,
      table.orderNumber,
    ),
    index("idx_orders_transaction_hash").on(table.transactionHash),
    check("type", sql.raw(`type IN (${orderTypeValues})`)),
    check("status", sql.raw(`status IN (${orderStatusValues})`)),
  ],
)

// =============================================================================
// TYPE INFERENCE HELPERS
// =============================================================================

// Database row types (what's actually stored in SQLite - all strings)
export type SubscriptionRow = typeof subscriptions.$inferSelect
export type NewSubscriptionRow = typeof subscriptions.$inferInsert

export type OrderRow = typeof orders.$inferSelect
export type NewOrderRow = typeof orders.$inferInsert

export type AccountRow = typeof accounts.$inferSelect
export type NewAccountRow = typeof accounts.$inferInsert

export type ApiKeyRow = typeof apiKeys.$inferSelect
export type NewApiKeyRow = typeof apiKeys.$inferInsert

export type WebhookRow = typeof webhooks.$inferSelect
export type NewWebhookRow = typeof webhooks.$inferInsert

// Domain types (what the application uses - with proper viem types)
// Repositories transform between Row and Domain types
export type Subscription = Omit<
  SubscriptionRow,
  "subscriptionId" | "beneficiaryAddress"
> & {
  subscriptionId: Hash
  beneficiaryAddress: Address
  testnet: boolean // Drizzle's mode: "boolean" makes this boolean not number
}

export type Order = Omit<OrderRow, "subscriptionId" | "transactionHash"> & {
  subscriptionId: Hash
  transactionHash?: Hash
}

export type Account = Omit<
  AccountRow,
  "address" | "subscriptionOwnerAddress"
> & {
  address: Address
  subscriptionOwnerAddress: Address | null
}

export type ApiKey = Omit<ApiKeyRow, never> & {
  enabled: boolean // Drizzle's mode: "boolean" makes this boolean not number
}

export type Webhook = Omit<WebhookRow, never> & {
  enabled: boolean
}
