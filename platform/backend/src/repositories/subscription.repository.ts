import type { LoggingLevel } from "@backend/constants/env.constants"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@backend/constants/subscription.constants"
import * as schema from "@backend/database/schema"
import { DrizzleLogger } from "@backend/lib/logger"
import type { Provider } from "@backend/providers/provider.interface"
import type { D1Database } from "@cloudflare/workers-types"
import { and, desc, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/d1"
import type { Address, Hash } from "viem"

// Re-export schema types (single source of truth)
export type Subscription = schema.Subscription
export type Order = schema.Order

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
  accountId: number
  beneficiaryAddress: Address
  provider: Provider
  testnet: boolean
}

interface SubscriptionExistsParams {
  subscriptionId: Hash
}

export interface DueOrder {
  id: number
  subscriptionId: Hash
  accountId: number
  amount: string
  attempts: number
  provider: Provider
  testnet: boolean
}

export interface OrderDetails {
  id: number
  subscriptionId: Hash
  accountId: number
  beneficiaryAddress: Address
  amount: string
  orderNumber: number
  status: string
  dueAt: string
  periodInSeconds: number
  attempts: number
  subscriptionStatus: string
  testnet: boolean
}

export interface UpdateOrderParams {
  id: number
  status: OrderStatus
  failureReason?: string // Mapped error code (e.g., 'INSUFFICIENT_SPENDING_ALLOWANCE')
  rawError?: string // Original error message for debugging
  transactionHash?: Hash // Transaction hash for successful payments
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
  accountId: number
  amount: string
  attempts: number
  provider: Provider
  testnet: boolean
}

export interface ListSubscriptionsParams {
  accountId: number
  testnet?: boolean
}

export interface GetSubscriptionOrdersParams {
  subscriptionId: Hash
}

export interface SubscriptionRepositoryDeps {
  DB: D1Database
  LOGGING: LoggingLevel
}

export interface CreateSubscriptionWithOrderParams {
  subscriptionId: Hash
  accountId: number // Who activated subscription (receives webhooks)
  beneficiaryAddress: Address // Who receives payments
  provider: Provider
  testnet: boolean
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
    const { subscriptionId, accountId, beneficiaryAddress, provider, testnet } =
      params
    // Use INSERT OR IGNORE to handle race conditions atomically
    // This ensures only one request can create the subscription
    const result = await this.db
      .insert(schema.subscriptions)
      .values({
        subscriptionId,
        accountId,
        beneficiaryAddress,
        status: SubscriptionStatus.PROCESSING,
        provider: provider,
        testnet,
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
   * Get subscription
   */
  async getSubscription(params: {
    subscriptionId: Hash
  }): Promise<Subscription | null> {
    const { subscriptionId } = params
    const result = await this.db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.subscriptionId, subscriptionId))
      .get()

    if (!result) return null

    // Transform DB strings to domain types
    return {
      ...result,
      subscriptionId: result.subscriptionId as Hash,
      beneficiaryAddress: result.beneficiaryAddress as Address,
    }
  }

  /**
   * List all subscriptions for an account
   * Optionally filter by testnet
   */
  async listSubscriptions(
    params: ListSubscriptionsParams,
  ): Promise<Subscription[]> {
    const { accountId, testnet } = params

    const conditions = [eq(schema.subscriptions.accountId, accountId)]

    if (testnet !== undefined) {
      conditions.push(eq(schema.subscriptions.testnet, testnet))
    }

    const results = await this.db
      .select()
      .from(schema.subscriptions)
      .where(and(...conditions))
      .orderBy(desc(schema.subscriptions.createdAt))
      .all()

    // Transform DB strings to domain types
    return results.map((sub) => ({
      ...sub,
      subscriptionId: sub.subscriptionId as Hash,
      beneficiaryAddress: sub.beneficiaryAddress as Address,
    }))
  }

  /**
   * Get all orders for a subscription
   * Returns orders with transaction hash if payment was successful
   */
  async getSubscriptionOrders(
    params: GetSubscriptionOrdersParams,
  ): Promise<Order[]> {
    const { subscriptionId } = params

    const results = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.subscriptionId, subscriptionId))
      .orderBy(desc(schema.orders.createdAt))
      .all()

    // Transform DB strings to domain types
    return results.map((order) => ({
      ...order,
      subscriptionId: order.subscriptionId as Hash,
      transactionHash: order.transactionHash
        ? (order.transactionHash as Hash)
        : undefined,
    }))
  }

  /**
   * Cancel subscription - sets status to canceled
   */
  async cancelSubscription(params: {
    subscriptionId: Hash
  }): Promise<Subscription> {
    const { subscriptionId } = params
    const result = await this.db
      .update(schema.subscriptions)
      .set({
        status: SubscriptionStatus.CANCELED,
        modifiedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(schema.subscriptions.subscriptionId, subscriptionId))
      .returning()
      .get()

    if (!result) {
      throw new Error(`Subscription ${subscriptionId} not found`)
    }

    // Transform DB strings to domain types
    return {
      ...result,
      subscriptionId: result.subscriptionId as Hash,
      beneficiaryAddress: result.beneficiaryAddress as Address,
    }
  }

  /**
   * Cancel all pending orders for a subscription
   * Returns the IDs of canceled orders (for DO cleanup)
   */
  async cancelPendingOrders(params: {
    subscriptionId: Hash
  }): Promise<number[]> {
    const { subscriptionId } = params

    // Get all pending orders
    const pendingOrders = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.subscriptionId, subscriptionId),
          eq(schema.orders.status, OrderStatus.PENDING),
        ),
      )
      .all()

    if (pendingOrders.length === 0) {
      return []
    }

    const orderIds = pendingOrders.map((o) => o.id)

    // Cancel them
    await this.db
      .update(schema.orders)
      .set({
        status: OrderStatus.FAILED,
        failureReason: "Subscription canceled",
      })
      .where(
        and(
          eq(schema.orders.subscriptionId, subscriptionId),
          eq(schema.orders.status, OrderStatus.PENDING),
        ),
      )
      .run()

    return orderIds
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
        accountId: schema.subscriptions.accountId,
        beneficiaryAddress: schema.subscriptions.beneficiaryAddress,
        subscriptionStatus: schema.subscriptions.status,
        testnet: schema.subscriptions.testnet,
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
      accountId: result.accountId,
      beneficiaryAddress: result.beneficiaryAddress as Address,
      amount: result.amount,
      orderNumber: result.orderNumber,
      status: result.status,
      dueAt: result.dueAt,
      periodInSeconds: result.periodInSeconds,
      attempts: result.attempts,
      subscriptionStatus: result.subscriptionStatus,
      testnet: result.testnet,
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
   * Get order by ID
   */
  async getOrderById(params: { orderId: number }): Promise<Order | null> {
    const result = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, params.orderId))
      .get()

    if (!result) {
      return null
    }

    return {
      ...result,
      subscriptionId: result.subscriptionId as Hash,
      transactionHash: result.transactionHash
        ? (result.transactionHash as Hash)
        : undefined,
    }
  }

  async deleteSubscriptionData(
    params: DeleteSubscriptionDataParams,
  ): Promise<void> {
    const { subscriptionId } = params
    await this.db.batch([
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
    const {
      subscriptionId,
      accountId,
      beneficiaryAddress,
      provider,
      testnet,
      order,
    } = params

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
          accountId,
          beneficiaryAddress,
          status: SubscriptionStatus.PROCESSING,
          provider: provider,
          testnet,
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
   * Updates subscription status, order with transaction hash, and creates next order
   * Returns the next order ID for scheduling
   */
  async executeSubscriptionActivation(
    params: ExecuteSubscriptionActivationParams,
  ): Promise<{ nextOrderId: number }> {
    const { subscriptionId, order, transaction, nextOrder } = params

    const [_updateOrderResult, nextOrderResult, _subscriptionResult] =
      await this.db.batch([
        // Mark order as completed and record transaction hash
        this.db
          .update(schema.orders)
          .set({
            status: OrderStatus.PAID,
            transactionHash: transaction.hash,
          })
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
          })
          .returning({ id: schema.orders.id }),
        // Activate subscription
        this.db
          .update(schema.subscriptions)
          .set({
            status: SubscriptionStatus.ACTIVE,
            modifiedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.subscriptions.subscriptionId, subscriptionId)),
      ])

    const nextOrderId = nextOrderResult[0]?.id
    if (!nextOrderId) {
      throw new Error("Failed to create next order during activation")
    }

    return { nextOrderId }
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
      account_id: number
      provider: string
      amount: string
      attempts: number
      testnet: number // SQLite stores boolean as INTEGER
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
          (SELECT account_id FROM subscriptions WHERE subscription_id = orders.subscription_id) as account_id,
          (SELECT provider FROM subscriptions WHERE subscription_id = orders.subscription_id) as provider,
          (SELECT testnet FROM subscriptions WHERE subscription_id = orders.subscription_id) as testnet,
          amount, attempts
      `),
    )

    // Transform DB strings to domain types
    return result.map((entry) => ({
      id: entry.id,
      subscriptionId: entry.subscription_id as Hash,
      accountId: entry.account_id,
      amount: entry.amount,
      attempts: entry.attempts,
      provider: entry.provider as Provider,
      testnet: Boolean(entry.testnet), // Convert INTEGER to boolean
    }))
  }

  /**
   * Update order status and return order details
   */
  async updateOrder(
    params: UpdateOrderParams,
  ): Promise<{ orderNumber: number }> {
    const { id, status, failureReason, rawError, transactionHash } = params

    const updateData: {
      status: OrderStatus
      failureReason?: string | null
      rawError?: string | null
      transactionHash?: string | null
    } = { status }

    if (failureReason || rawError) {
      updateData.failureReason = failureReason || null
      updateData.rawError = rawError || null
    }

    if (transactionHash) {
      updateData.transactionHash = transactionHash
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
        accountId: schema.subscriptions.accountId,
        provider: schema.subscriptions.provider,
        testnet: schema.subscriptions.testnet,
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
      accountId: entry.accountId,
      amount: entry.amount,
      attempts: entry.attempts,
      provider: entry.provider as Provider,
      testnet: entry.testnet,
    }))
  }
}
