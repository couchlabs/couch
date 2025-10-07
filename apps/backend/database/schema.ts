import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core"
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

// =============================================================================
// Accounts table - tied to merchant wallet address (checksummed 0x...)
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
    ownerAddress: text("owner_address").notNull(),
    accountAddress: text("account_address").references(() => accounts.address),
    providerId: text("provider_id").notNull(),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
    modifiedAt: text("modified_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_subscriptions_created").on(table.createdAt),
    index("idx_subscriptions_status").on(table.status),
    index("idx_subscriptions_owner").on(table.ownerAddress),
    index("idx_subscriptions_account").on(table.accountAddress),
    check("status", sql.raw(`status IN (${subscriptionStatusValues})`)),
    check("provider_id", sql.raw(`provider_id IN (${providerValues})`)),
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
    orderNumber: integer("order_number"),
    attempts: integer("attempts").default(0),
    parentOrderId: integer("parent_order_id"),
    nextRetryAt: text("next_retry_at"),
    failureReason: text("failure_reason"),
    rawError: text("raw_error"),
    periodLengthInSeconds: integer("period_length_in_seconds"),
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

export type Subscription = typeof subscriptions.$inferSelect
export type NewSubscription = typeof subscriptions.$inferInsert
export type Order = typeof orders.$inferSelect
export type NewOrder = typeof orders.$inferInsert
export type Transaction = typeof transactions.$inferSelect
export type NewTransaction = typeof transactions.$inferInsert
export type Account = typeof accounts.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
export type Webhook = typeof webhooks.$inferSelect
