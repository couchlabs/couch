import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"
import type { Address, Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
  TransactionStatus,
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
const transactionStatusValues = Object.values(TransactionStatus)
  .map((s) => `'${s}'`)
  .join(", ")
const providerValues = Object.values(Provider)
  .map((p) => `'${p}'`)
  .join(", ")

// =============================================================================
// ACCOUNT TABLES
// =============================================================================

export const accounts = sqliteTable("accounts", {
  address: text("address").primaryKey(),
})

// API Keys - SHA-256 hash of the secret part (no prefix)
export const apiKeys = sqliteTable(
  "api_keys",
  {
    keyHash: text("key_hash").primaryKey(),
    accountAddress: text("account_address")
      .notNull()
      .references(() => accounts.address, { onDelete: "cascade" }),
  },
  (table) => [index("idx_api_keys_account").on(table.accountAddress)],
)

// Webhooks - single webhook per account (HTTPS URL for event delivery, secret for HMAC verification)
export const webhooks = sqliteTable("webhooks", {
  accountAddress: text("account_address")
    .primaryKey()
    .references(() => accounts.address, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
})

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
    accountAddress: text("account_address")
      .notNull()
      .references(() => accounts.address),
    // Who receives payments
    beneficiaryAddress: text("beneficiary_address").notNull(),
    provider: text("provider").$type<Provider>().notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    modifiedAt: text("modified_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_subscriptions_account").on(table.accountAddress),
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
    check("type", sql.raw(`type IN (${orderTypeValues})`)),
    check("status", sql.raw(`status IN (${orderStatusValues})`)),
  ],
)

// Transaction log - actual onchain transactions
// transactionHash: Can be shared when SDK batches multiple orders
// orderId: Unique per order
// amount: In USDC base units
export const transactions = sqliteTable(
  "transactions",
  {
    transactionHash: text("transaction_hash").notNull(),
    orderId: integer("order_id")
      .primaryKey()
      .references(() => orders.id),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscriptions.subscriptionId),
    amount: text("amount").notNull(),
    status: text("status").$type<TransactionStatus>().notNull(),
    gasUsed: text("gas_used"),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_transactions_created").on(table.createdAt),
    index("idx_transactions_subscription").on(table.subscriptionId),
    index("idx_transactions_order").on(table.orderId),
    index("idx_transactions_hash").on(table.transactionHash),
    index("idx_transactions_status").on(table.status),
    check("status", sql.raw(`status IN (${transactionStatusValues})`)),
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

export type TransactionRow = typeof transactions.$inferSelect
export type NewTransactionRow = typeof transactions.$inferInsert

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
  "subscriptionId" | "accountAddress" | "beneficiaryAddress"
> & {
  subscriptionId: Hash
  accountAddress: Address
  beneficiaryAddress: Address
}

export type Order = Omit<OrderRow, "subscriptionId"> & {
  subscriptionId: Hash
}

export type Transaction = Omit<
  TransactionRow,
  "transactionHash" | "subscriptionId"
> & {
  transactionHash: Hash
  subscriptionId: Hash
}

export type Account = Omit<AccountRow, "address"> & {
  address: Address
}

export type ApiKey = Omit<ApiKeyRow, "accountAddress"> & {
  accountAddress: Address
}

export type Webhook = Omit<WebhookRow, "accountAddress"> & {
  accountAddress: Address
}
