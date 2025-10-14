import type { D1Database } from "@cloudflare/workers-types"
import * as schema from "@database/schema"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import type { Address, Hash } from "viem"
import type { LoggingLevel } from "@/constants/env.constants"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
  TransactionStatus,
} from "@/constants/subscription.constants"
import { DrizzleLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"

// Re-export schema types (single source of truth)
export type Subscription = schema.Subscription
export type Order = schema.Order
export type Transaction = schema.Transaction

// Custom parameter/result types (not in schema)
export interface CreateOrderParams {
  subscriptionId: Hash
  type: OrderType
  dueAt: string
  amount: string
  periodInSeconds: number // Duration of billing period
  status: OrderStatus
}

// Method parameter interfaces
export interface CreateSubscriptionParams {
  subscriptionId: Hash
  ownerAddress: Address
  accountAddress: Address
  providerId: Provider
}

interface SubscriptionExistsParams {
  subscriptionId: Hash
}

export interface GetSuccessfulTransactionParams {
  subscriptionId: Hash
  orderId: number
}

export interface DueOrder {
  id: number
  subscriptionId: Hash
  accountAddress: Address
  amount: string
  attempts: number
  providerId: Provider
}

export interface OrderDetails {
  id: number
  subscriptionId: Hash
  accountAddress: Address
  amount: string
  orderNumber: number
  status: string
  dueAt: string
  periodInSeconds: number
  attempts: number
}

export interface RecordTransactionParams {
  transactionHash: Hash
  orderId: number
  subscriptionId: Hash
  amount: string
  status: TransactionStatus
}

export interface UpdateOrderParams {
  id: number
  status: OrderStatus
  failureReason?: string // Mapped error code (e.g., 'INSUFFICIENT_SPENDING_ALLOWANCE')
  rawError?: string // Original error message for debugging
}

export interface UpdateSubscriptionParams {
  subscriptionId: Hash
  status: SubscriptionStatus
}

export interface DeleteSubscriptionDataParams {
  subscriptionId: Hash
}

export interface ScheduleRetryParams {
  orderId: number
  subscriptionId: Hash
  nextRetryAt: string
  failureReason?: string
  rawError?: string
}

export interface ReactivateSubscriptionParams {
  orderId: number
  subscriptionId: Hash
}

export interface DueRetry {
  id: number
  subscriptionId: Hash
  accountAddress: Address
  amount: string
  attempts: number
  providerId: Provider
}

export interface SubscriptionRepositoryDeps {
  DB: D1Database
  LOGGING: LoggingLevel
}

export interface CreateSubscriptionWithOrderParams {
  subscriptionId: Hash
  ownerAddress: Address // Couch's smart wallet (the spender)
  accountAddress: Address // Merchant's account address (from auth)
  providerId: Provider
  order: CreateOrderParams
}

export type CreateSubscriptionWithOrderResult =
  | {
      created: true
      orderId: number
      orderNumber: number
    }
  | {
      created: false
    }

export interface ExecuteSubscriptionActivationParams {
  subscriptionId: Hash
  order: {
    id: number
  }
  transaction: {
    hash: Hash
    amount: string
  }
  nextOrder: {
    dueAt: string
    amount: string
    periodInSeconds: number
  }
}

export interface MarkSubscriptionIncompleteParams {
  subscriptionId: Hash
  orderId: number
  reason: string
}

export class SubscriptionRepository {
  private db: ReturnType<typeof drizzle<typeof schema>>

  constructor(deps: SubscriptionRepositoryDeps) {
    this.db = drizzle(deps.DB, {
      schema,
      logger:
        deps.LOGGING === "verbose"
          ? new DrizzleLogger("subscription.repository")
          : undefined,
    })
  }

  /**
   * Transform database row to domain type for Transaction
   */
  private toTransactionDomain(row: schema.TransactionRow): Transaction {
    return {
      ...row,
      transactionHash: row.transactionHash as Hash,
      subscriptionId: row.subscriptionId as Hash,
    }
  }

  /**
   * Helper to generate next order number for a subscription
   * Uses COALESCE to handle first order (NULL → 0 → 1)
   */
  private getNextOrderNumber(subscriptionId: Hash) {
    return sql<number>`COALESCE(
      (SELECT MAX(${schema.orders.orderNumber})
       FROM ${schema.orders}
       WHERE ${schema.orders.subscriptionId} = ${subscriptionId}),
      0
    ) + 1`
  }

  /**
   * Creates a subscription record if it doesn't exist
   * Returns true if created, false if already exists
   * This is atomic - prevents race conditions
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<boolean> {
    const { subscriptionId, ownerAddress, accountAddress, providerId } = params
    // Use INSERT OR IGNORE to handle race conditions atomically
    // This ensures only one request can create the subscription
    const result = await this.db
      .insert(schema.subscriptions)
      .values({
        subscriptionId,
        ownerAddress,
        accountAddress,
        status: SubscriptionStatus.PROCESSING,
        providerId,
      })
      .onConflictDoNothing()
      .run()

    return result.meta.changes > 0
  }

  /**
   * Check if a subscription already exists (for early validation)
   */
  async subscriptionExists(params: SubscriptionExistsParams): Promise<boolean> {
    const { subscriptionId } = params
    const result = await this.db
      .select({ exists: sql<number>`1` })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.subscriptionId, subscriptionId))
      .get()

    return !!result
  }

  /**
   * Get order details with subscription info for processing
   */
  async getOrderDetails(orderId: number): Promise<OrderDetails | null> {
    const result = await this.db
      .select({
        id: schema.orders.id,
        subscriptionId: schema.orders.subscriptionId,
        amount: schema.orders.amount,
        orderNumber: schema.orders.orderNumber,
        status: schema.orders.status,
        dueAt: schema.orders.dueAt,
        periodInSeconds: schema.orders.periodLengthInSeconds,
        attempts: schema.orders.attempts,
        accountAddress: schema.subscriptions.accountAddress,
      })
      .from(schema.orders)
      .innerJoin(
        schema.subscriptions,
        eq(schema.orders.subscriptionId, schema.subscriptions.subscriptionId),
      )
      .where(eq(schema.orders.id, orderId))
      .get()

    if (!result) return null

    // Transform DB strings to domain types
    return {
      id: result.id,
      subscriptionId: result.subscriptionId as Hash,
      accountAddress: result.accountAddress as Address,
      amount: result.amount,
      orderNumber: result.orderNumber,
      status: result.status,
      dueAt: result.dueAt,
      periodInSeconds: result.periodInSeconds,
      attempts: result.attempts,
    }
  }

  async createOrder(order: CreateOrderParams): Promise<number | null> {
    const result = await this.db
      .insert(schema.orders)
      .values({
        subscriptionId: order.subscriptionId,
        orderNumber: this.getNextOrderNumber(order.subscriptionId),
        type: order.type,
        dueAt: order.dueAt,
        amount: order.amount,
        periodLengthInSeconds: order.periodInSeconds,
        status: order.status || OrderStatus.PROCESSING,
      })
      .returning({ id: schema.orders.id })
      .get()

    return result?.id ?? null
  }

  /**
   * Check for existing successful transaction (for idempotency)
   */
  async getSuccessfulTransaction(
    params: GetSuccessfulTransactionParams,
  ): Promise<Transaction | null> {
    const { subscriptionId, orderId } = params
    const result = await this.db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.subscriptionId, subscriptionId),
          eq(schema.transactions.orderId, orderId),
          eq(schema.transactions.status, TransactionStatus.CONFIRMED),
        ),
      )
      .get()

    return result ? this.toTransactionDomain(result) : null
  }

  async deleteSubscriptionData(
    params: DeleteSubscriptionDataParams,
  ): Promise<void> {
    const { subscriptionId } = params
    await this.db.batch([
      this.db
        .delete(schema.transactions)
        .where(eq(schema.transactions.subscriptionId, subscriptionId)),
      this.db
        .delete(schema.orders)
        .where(eq(schema.orders.subscriptionId, subscriptionId)),
      this.db
        .delete(schema.subscriptions)
        .where(eq(schema.subscriptions.subscriptionId, subscriptionId)),
    ])
  }

  /**
   * TRANSACTION: Create subscription and initial order atomically
   * This ensures we either create both or neither
   */
  async createSubscriptionWithOrder(
    params: CreateSubscriptionWithOrderParams,
  ): Promise<CreateSubscriptionWithOrderResult> {
    const { subscriptionId, ownerAddress, accountAddress, providerId, order } =
      params

    // First, check if subscription exists (outside batch for early exit)
    const exists = await this.subscriptionExists({ subscriptionId })
    if (exists) {
      return { created: false }
    }

    try {
      // Use batch for atomic operations - both succeed or both fail
      const [subResult, orderResult] = await this.db.batch([
        this.db.insert(schema.subscriptions).values({
          subscriptionId,
          ownerAddress,
          status: SubscriptionStatus.PROCESSING,
          accountAddress,
          providerId,
        }),
        this.db
          .insert(schema.orders)
          .values({
            subscriptionId: order.subscriptionId,
            orderNumber: this.getNextOrderNumber(order.subscriptionId),
            type: order.type,
            dueAt: order.dueAt,
            amount: order.amount,
            periodLengthInSeconds: order.periodInSeconds,
            status: order.status || OrderStatus.PROCESSING,
          })
          .returning({
            id: schema.orders.id,
            orderNumber: schema.orders.orderNumber,
          }),
      ])

      // Check if subscription was actually created (race condition check)
      if (subResult.meta.changes === 0) {
        // Shouldn't happen in batch, but handle defensively
        await this.deleteSubscriptionData({ subscriptionId })
        return { created: false }
      }

      // Batch succeeded - both order id and orderNumber must exist
      const createdOrder = orderResult[0]
      if (!createdOrder?.id || !createdOrder?.orderNumber) {
        throw new Error("Order creation failed - missing id or orderNumber")
      }

      return {
        created: true,
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
      }
    } catch {
      // Batch failed (likely UNIQUE constraint violation from race condition)
      // No cleanup needed since batch is atomic
      return { created: false }
    }
  }

  /**
   * TRANSACTION: Finalize subscription activation
   * Updates subscription status, order, creates transaction, and next order
   */
  async executeSubscriptionActivation(
    params: ExecuteSubscriptionActivationParams,
  ): Promise<void> {
    const { subscriptionId, order, transaction, nextOrder } = params
    await this.db.batch([
      // Create transaction record
      this.db
        .insert(schema.transactions)
        .values({
          transactionHash: transaction.hash,
          orderId: order.id,
          subscriptionId,
          amount: transaction.amount,
          status: TransactionStatus.CONFIRMED,
        }),
      // Mark order as completed
      this.db
        .update(schema.orders)
        .set({ status: OrderStatus.PAID })
        .where(eq(schema.orders.id, order.id)),
      // Create next order with auto-incremented order_number
      this.db
        .insert(schema.orders)
        .values({
          subscriptionId,
          orderNumber: this.getNextOrderNumber(subscriptionId),
          type: OrderType.RECURRING,
          dueAt: nextOrder.dueAt,
          amount: nextOrder.amount,
          periodLengthInSeconds: nextOrder.periodInSeconds,
          status: OrderStatus.PENDING,
        }),
      // Activate subscription
      this.db
        .update(schema.subscriptions)
        .set({
          status: SubscriptionStatus.ACTIVE,
          modifiedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.subscriptions.subscriptionId, subscriptionId)),
    ])
  }

  /**
   * COMPENSATING ACTION: Mark subscription as incomplete
   * Used when charge fails after subscription creation
   */
  async markSubscriptionIncomplete(
    params: MarkSubscriptionIncompleteParams,
  ): Promise<void> {
    const { subscriptionId, orderId, reason } = params
    await this.db.batch([
      // Mark subscription as incomplete
      this.db
        .update(schema.subscriptions)
        .set({
          status: SubscriptionStatus.INCOMPLETE,
          modifiedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.subscriptions.subscriptionId, subscriptionId)),
      // Mark order as failed
      this.db
        .update(schema.orders)
        .set({
          status: OrderStatus.FAILED,
          failureReason: reason,
        })
        .where(eq(schema.orders.id, orderId)),
    ])
  }

  /**
   * Atomically claim due orders for processing
   * This prevents race conditions between multiple schedulers
   */
  async claimDueOrders(limit: number = 100): Promise<DueOrder[]> {
    // Use correlated subqueries in RETURNING - the only pattern D1 supports
    // sql.raw() bypasses Drizzle's table name quoting which breaks D1
    const result = await this.db.all<{
      id: number
      subscription_id: string
      account_address: string
      provider_id: string
      amount: string
      attempts: number
    }>(
      sql.raw(`
        UPDATE orders
        SET status = '${OrderStatus.PROCESSING}'
        WHERE id IN (
          SELECT o.id
          FROM orders o
          JOIN subscriptions s ON o.subscription_id = s.subscription_id
          WHERE o.status = '${OrderStatus.PENDING}'
            AND datetime(substr(o.due_at, 1, 19)) <= datetime('now', 'utc')
            AND s.status = '${SubscriptionStatus.ACTIVE}'
          ORDER BY o.due_at
          LIMIT ${limit}
        )
        RETURNING id, subscription_id,
          (SELECT account_address FROM subscriptions WHERE subscription_id = orders.subscription_id) as account_address,
          (SELECT provider_id FROM subscriptions WHERE subscription_id = orders.subscription_id) as provider_id,
          amount, attempts
      `),
    )

    // Transform DB strings to domain types
    return result.map((entry) => ({
      id: entry.id,
      subscriptionId: entry.subscription_id as Hash,
      accountAddress: entry.account_address as Address,
      amount: entry.amount,
      attempts: entry.attempts,
      providerId: entry.provider_id as Provider,
    }))
  }

  /**
   * Record a transaction for an order
   */
  async recordTransaction(params: RecordTransactionParams): Promise<void> {
    const { transactionHash, orderId, subscriptionId, amount, status } = params

    await this.db
      .insert(schema.transactions)
      .values({
        transactionHash,
        orderId,
        subscriptionId,
        amount,
        status,
      })
      .run()
  }

  /**
   * Update order status and return order details
   */
  async updateOrder(
    params: UpdateOrderParams,
  ): Promise<{ orderNumber: number }> {
    const { id, status, failureReason, rawError } = params

    const updateData: {
      status: OrderStatus
      failureReason?: string | null
      rawError?: string | null
    } = { status }

    if (failureReason || rawError) {
      updateData.failureReason = failureReason || null
      updateData.rawError = rawError || null
    }

    const result = await this.db
      .update(schema.orders)
      .set(updateData)
      .where(eq(schema.orders.id, id))
      .returning({ orderNumber: schema.orders.orderNumber })
      .get()

    if (!result) {
      throw new Error(`Failed to update order ${id} - order not found`)
    }

    return { orderNumber: result.orderNumber }
  }

  /**
   * Update subscription status
   */
  async updateSubscription(params: UpdateSubscriptionParams): Promise<void> {
    const { subscriptionId, status } = params

    await this.db
      .update(schema.subscriptions)
      .set({
        status,
        modifiedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.subscriptions.subscriptionId, subscriptionId))
      .run()
  }

  /**
   * TRANSACTION: Schedule payment retry atomically
   * Updates order with next retry date and marks subscription as PAST_DUE
   */
  async scheduleRetry(params: ScheduleRetryParams): Promise<void> {
    const { orderId, subscriptionId, nextRetryAt, failureReason, rawError } =
      params

    await this.db.batch([
      // Increment attempts and set next retry date
      this.db
        .update(schema.orders)
        .set({
          attempts: sql`${schema.orders.attempts} + 1`,
          nextRetryAt,
          status: OrderStatus.FAILED,
          failureReason: failureReason || null,
          rawError: rawError || null,
        })
        .where(eq(schema.orders.id, orderId)),
      // Mark subscription as past due
      this.db
        .update(schema.subscriptions)
        .set({
          status: SubscriptionStatus.PAST_DUE,
          modifiedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.subscriptions.subscriptionId, subscriptionId)),
    ])
  }

  /**
   * TRANSACTION: Reactivate subscription after successful retry
   * Clears next retry date and marks subscription as ACTIVE
   */
  async reactivateSubscription(
    params: ReactivateSubscriptionParams,
  ): Promise<void> {
    const { orderId, subscriptionId } = params

    await this.db.batch([
      // Clear next retry date
      this.db
        .update(schema.orders)
        .set({
          nextRetryAt: null,
        })
        .where(eq(schema.orders.id, orderId)),
      // Reactivate subscription
      this.db
        .update(schema.subscriptions)
        .set({
          status: SubscriptionStatus.ACTIVE,
          modifiedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.subscriptions.subscriptionId, subscriptionId)),
    ])
  }

  /**
   * Get orders due for payment retry
   * Uses Drizzle query builder for type safety
   */
  async getDueRetries(limit: number = 100): Promise<DueRetry[]> {
    const result = await this.db
      .select({
        id: schema.orders.id,
        subscriptionId: schema.orders.subscriptionId,
        accountAddress: schema.subscriptions.accountAddress,
        providerId: schema.subscriptions.providerId,
        amount: schema.orders.amount,
        attempts: schema.orders.attempts,
      })
      .from(schema.orders)
      .innerJoin(
        schema.subscriptions,
        eq(schema.orders.subscriptionId, schema.subscriptions.subscriptionId),
      )
      .where(
        and(
          eq(schema.orders.status, OrderStatus.FAILED),
          eq(schema.subscriptions.status, SubscriptionStatus.PAST_DUE),
          sql`datetime(substr(${schema.orders.nextRetryAt}, 1, 19)) <= datetime('now', 'utc')`,
        ),
      )
      .orderBy(sql`datetime(substr(${schema.orders.nextRetryAt}, 1, 19))`)
      .limit(limit)
      .all()

    // Transform DB strings to domain types
    return result.map((entry) => ({
      id: entry.id,
      subscriptionId: entry.subscriptionId as Hash,
      accountAddress: entry.accountAddress as Address,
      amount: entry.amount,
      attempts: entry.attempts,
      providerId: entry.providerId as Provider,
    }))
  }
}
