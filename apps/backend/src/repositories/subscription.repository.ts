import { env } from "cloudflare:workers"
import type { D1Database } from "@cloudflare/workers-types"
import type { Address, Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
  TransactionStatus,
} from "@/constants/subscription.constants"
import type { Provider } from "@/providers/provider.interface"

// import { createLogger } from "@/lib/logger"
// const logger = createLogger('subscription:repository')

export interface Subscription {
  subscriptionId: Hash
  status: SubscriptionStatus
  ownerAddress: Address
  accountAddress: Address // Merchant account that receives payments
  providerId: Provider
  createdAt?: string
  modifiedAt?: string
}

export interface Order {
  id?: number
  subscriptionId: string
  orderNumber: number // Sequential number per subscription (1, 2, 3...)
  type: OrderType
  dueAt: string
  amount: string
  status: OrderStatus
  attempts?: number
  parentOrderId?: number
  failureReason?: string
  processingLock?: string
  lockedBy?: string
  createdAt?: string
}

export interface CreateOrderParams {
  subscriptionId: Hash
  type: OrderType
  dueAt: string
  amount: string
  periodInSeconds: number // Duration of billing period
  status: OrderStatus
}

export interface Transaction {
  transactionHash: Hash
  orderId: number
  subscriptionId: Hash
  amount: string
  status: TransactionStatus
  failureReason?: string
  gasUsed?: string
  createdAt?: string
}

// Method parameter interfaces
export interface CreateSubscriptionParams {
  subscriptionId: Hash
  ownerAddress: Address
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
}

export interface RecordTransactionParams {
  transactionHash: Hash
  orderId: number
  subscriptionId: Hash
  amount: string
  status: string
}

export interface UpdateOrderParams {
  id: number
  status: OrderStatus
  failureReason?: string // Mapped error code (e.g., 'INSUFFICIENT_SPENDING_ALLOWANCE')
  rawError?: string // Original error message for debugging
}

export interface UpdateSubscriptionParams {
  subscriptionId: Hash
  status: string
}

export interface DeleteSubscriptionDataParams {
  subscriptionId: Hash
}

export interface CreateSubscriptionWithOrderParams {
  subscriptionId: Hash
  ownerAddress: Address // Couch's smart wallet (the spender)
  accountAddress: Address // Merchant's account address (from auth)
  providerId: Provider
  order: CreateOrderParams
}

export interface CreateSubscriptionWithOrderResult {
  created: boolean
  orderId?: number
  orderNumber?: number
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

export interface MarkSubscriptionInactiveParams {
  subscriptionId: Hash
  orderId: number
  reason: string
}

export class SubscriptionRepository {
  private db: D1Database

  constructor() {
    this.db = env.DB
  }

  /**
   * Creates a subscription record if it doesn't exist
   * Returns true if created, false if already exists
   * This is atomic - prevents race conditions
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<boolean> {
    const { subscriptionId, ownerAddress, providerId } = params
    // Use INSERT OR IGNORE to handle race conditions atomically
    // This ensures only one request can create the subscription
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO subscriptions (subscription_id, owner_address, status, provider_id)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        subscriptionId,
        ownerAddress,
        SubscriptionStatus.PROCESSING,
        providerId,
      )
      .run()

    return result.meta.changes > 0
  }

  /**
   * Check if a subscription already exists (for early validation)
   */
  async subscriptionExists(params: SubscriptionExistsParams): Promise<boolean> {
    const { subscriptionId } = params
    const result = await this.db
      .prepare("SELECT 1 FROM subscriptions WHERE subscription_id = ? LIMIT 1")
      .bind(subscriptionId)
      .first()

    return result !== null
  }

  /**
   * Get order details with subscription info for processing
   */
  async getOrderDetails(orderId: number): Promise<OrderDetails | null> {
    const result = await this.db
      .prepare(
        `SELECT
          o.id,
          o.subscription_id,
          o.amount,
          o.order_number,
          o.status,
          o.due_at,
          o.period_length_in_seconds,
          s.account_address
        FROM orders o
        JOIN subscriptions s ON o.subscription_id = s.subscription_id
        WHERE o.id = ?`,
      )
      .bind(orderId)
      .first<{
        id: number
        subscription_id: string
        amount: string
        order_number: number
        status: string
        due_at: string
        period_length_in_seconds: number
        account_address: string
      }>()

    if (!result) return null

    return {
      id: result.id,
      subscriptionId: result.subscription_id as Hash,
      accountAddress: result.account_address as Address,
      amount: result.amount,
      orderNumber: result.order_number,
      status: result.status,
      dueAt: result.due_at,
      periodInSeconds: result.period_length_in_seconds,
    }
  }

  async getSubscription(subscriptionId: Hash): Promise<Subscription | null> {
    const result = await this.db
      .prepare("SELECT * FROM subscriptions WHERE subscription_id = ?")
      .bind(subscriptionId)
      .first<{
        subscription_id: string
        status: SubscriptionStatus
        owner_address: string
        account_address: string
        provider_id: string
        created_at?: string
        modified_at?: string
      }>()

    if (!result) return null

    return {
      subscriptionId: result.subscription_id as Hash,
      status: result.status,
      ownerAddress: result.owner_address as Address,
      accountAddress: result.account_address as Address,
      providerId: result.provider_id as Provider,
      createdAt: result.created_at,
      modifiedAt: result.modified_at,
    }
  }

  async createOrder(order: CreateOrderParams): Promise<number | undefined> {
    const result = await this.db
      .prepare(
        `INSERT INTO orders (
          subscription_id, order_number, type, due_at, amount, period_length_in_seconds, status
        ) VALUES (
          ?,
          COALESCE((SELECT MAX(order_number) FROM orders WHERE subscription_id = ?), 0) + 1,
          ?, ?, ?, ?, ?
        )
        RETURNING id`,
      )
      .bind(
        order.subscriptionId,
        order.subscriptionId, // For the subquery
        order.type,
        order.dueAt,
        order.amount,
        order.periodInSeconds,
        order.status || OrderStatus.PROCESSING,
      )
      .first<{ id: number }>()

    return result?.id
  }

  async createTransaction(transaction: Transaction): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO transactions (
          transaction_hash, order_id, subscription_id, amount, status
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        transaction.transactionHash, // transaction_hash column (PK)
        transaction.orderId,
        transaction.subscriptionId,
        transaction.amount,
        transaction.status,
      )
      .run()
  }

  /**
   * Check for existing successful transaction (for idempotency)
   */
  async getSuccessfulTransaction(
    params: GetSuccessfulTransactionParams,
  ): Promise<Transaction | null> {
    const { subscriptionId, orderId } = params
    const result = await this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE subscription_id = ?
         AND order_id = ?
         AND status = ?
         LIMIT 1`,
      )
      .bind(subscriptionId, orderId, TransactionStatus.CONFIRMED)
      .first<{
        transaction_hash: string
        order_id: number
        subscription_id: string
        amount: string
        status: string
        failure_reason?: string
        gas_used?: string
        created_at?: string
      }>()

    return result
      ? {
          transactionHash: result.transaction_hash as Hash,
          orderId: result.order_id,
          subscriptionId: result.subscription_id as Hash,
          amount: result.amount,
          status: result.status as TransactionStatus,
          failureReason: result.failure_reason,
          gasUsed: result.gas_used,
          createdAt: result.created_at,
        }
      : null
  }

  async deleteSubscriptionData(
    params: DeleteSubscriptionDataParams,
  ): Promise<void> {
    const { subscriptionId } = params
    await this.db.batch([
      this.db
        .prepare("DELETE FROM transactions WHERE subscription_id = ?")
        .bind(subscriptionId),
      this.db
        .prepare("DELETE FROM orders WHERE subscription_id = ?")
        .bind(subscriptionId),
      this.db
        .prepare("DELETE FROM subscriptions WHERE subscription_id = ?")
        .bind(subscriptionId),
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
    try {
      // D1 supports transactions via batch
      // First, check if subscription exists
      const exists = await this.subscriptionExists({ subscriptionId })
      if (exists) {
        return { created: false }
      }

      // Create subscription linked to merchant account
      const subResult = await this.db
        .prepare(
          `INSERT INTO subscriptions (subscription_id, owner_address, status, account_address, provider_id)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          subscriptionId,
          ownerAddress,
          SubscriptionStatus.PROCESSING,
          accountAddress,
          providerId,
        )
        .run()

      if (subResult.meta.changes === 0) {
        // Race condition - another request created it
        return { created: false }
      }

      // Create order with auto-calculated order_number (starts at 1)
      const orderResult = await this.db
        .prepare(
          `INSERT INTO orders (
            subscription_id, order_number, type, due_at, amount, period_length_in_seconds, status
          ) VALUES (
            ?,
            COALESCE((SELECT MAX(order_number) FROM orders WHERE subscription_id = ?), 0) + 1,
            ?, ?, ?, ?, ?
          )
          RETURNING id, order_number`,
        )
        .bind(
          order.subscriptionId,
          order.subscriptionId, // For the subquery
          order.type,
          order.dueAt,
          order.amount,
          order.periodInSeconds,
          order.status || OrderStatus.PROCESSING,
        )
        .first<{ id: number; order_number: number }>()

      return {
        created: true,
        orderId: orderResult?.id,
        orderNumber: orderResult?.order_number,
      }
    } catch (error) {
      // If anything fails, clean up
      await this.deleteSubscriptionData({ subscriptionId })
      throw error
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
        .prepare(
          `INSERT INTO transactions (
            transaction_hash, order_id, subscription_id, amount, status
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          transaction.hash, // transaction_hash column (PK)
          order.id,
          subscriptionId,
          transaction.amount,
          TransactionStatus.CONFIRMED,
        ),
      // Mark order as completed
      this.db
        .prepare(`UPDATE orders SET status = ? WHERE id = ?`)
        .bind(OrderStatus.PAID, order.id),
      // Create next order with auto-incremented order_number
      this.db
        .prepare(
          `INSERT INTO orders (
            subscription_id, order_number, type, due_at, amount, period_length_in_seconds, status
          ) VALUES (
            ?,
            COALESCE((SELECT MAX(order_number) FROM orders WHERE subscription_id = ?), 0) + 1,
            ?, ?, ?, ?, ?
          )`,
        )
        .bind(
          subscriptionId,
          subscriptionId, // For the subquery
          OrderType.RECURRING,
          nextOrder.dueAt,
          nextOrder.amount,
          nextOrder.periodInSeconds,
          OrderStatus.PENDING,
        ),
      // Activate subscription
      this.db
        .prepare(
          `UPDATE subscriptions SET status = ?, modified_at = CURRENT_TIMESTAMP
           WHERE subscription_id = ?`,
        )
        .bind(SubscriptionStatus.ACTIVE, subscriptionId),
    ])
  }

  /**
   * COMPENSATING ACTION: Mark subscription as inactive
   * Used when charge fails after subscription creation
   */
  async markSubscriptionInactive(
    params: MarkSubscriptionInactiveParams,
  ): Promise<void> {
    const { subscriptionId, orderId, reason } = params
    await this.db.batch([
      // Mark subscription as inactive
      this.db
        .prepare(
          `UPDATE subscriptions
           SET status = ?, modified_at = CURRENT_TIMESTAMP
           WHERE subscription_id = ?`,
        )
        .bind(SubscriptionStatus.INACTIVE, subscriptionId),
      // Mark order as failed
      this.db
        .prepare(
          `UPDATE orders
           SET status = ?, failure_reason = ?
           WHERE id = ?`,
        )
        .bind(OrderStatus.FAILED, reason, orderId),
    ])
  }

  /**
   * Atomically claim due orders for processing
   * This prevents race conditions between multiple schedulers
   */
  async claimDueOrders(limit: number = 100): Promise<DueOrder[]> {
    const result = await this.db
      .prepare(
        `UPDATE orders
         SET status = ?
         WHERE id IN (
           SELECT o.id
           FROM orders o
           JOIN subscriptions s ON o.subscription_id = s.subscription_id
           WHERE o.status = ?
             AND datetime(substr(o.due_at, 1, 19)) <= datetime('now', 'utc')
             AND s.status = ?
           ORDER BY o.due_at
           LIMIT ?
         )
         RETURNING id, subscription_id,
                  (SELECT account_address FROM subscriptions WHERE subscription_id = orders.subscription_id) as account_address,
                  (SELECT provider_id FROM subscriptions WHERE subscription_id = orders.subscription_id) as provider_id,
                  amount, attempts`,
      )
      .bind(OrderStatus.PROCESSING, OrderStatus.PENDING, "active", limit)
      .all<{
        id: number
        subscription_id: string
        account_address: string
        provider_id: string
        amount: string
        attempts: number
      }>()

    return (result.results || []).map((entry) => ({
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
      .prepare(
        `INSERT INTO transactions (
          transaction_hash, order_id, subscription_id, amount, status
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(transactionHash, orderId, subscriptionId, amount, status)
      .run()
  }

  /**
   * Update order status and return order details
   */
  async updateOrder(
    params: UpdateOrderParams,
  ): Promise<{ orderNumber: number }> {
    const { id, status, failureReason, rawError } = params

    let result: { order_number: number } | undefined
    if (failureReason || rawError) {
      result = await this.db
        .prepare(
          `UPDATE orders
           SET status = ?, failure_reason = ?, raw_error = ?
           WHERE id = ?
           RETURNING order_number`,
        )
        .bind(status, failureReason || null, rawError || null, id)
        .first<{ order_number: number }>()
    } else {
      result = await this.db
        .prepare(
          `UPDATE orders
           SET status = ?
           WHERE id = ?
           RETURNING order_number`,
        )
        .bind(status, id)
        .first<{ order_number: number }>()
    }

    if (!result) {
      throw new Error(`Failed to update order ${id} - order not found`)
    }

    return { orderNumber: result.order_number }
  }

  /**
   * Update subscription status
   */
  async updateSubscription(params: UpdateSubscriptionParams): Promise<void> {
    const { subscriptionId, status } = params

    await this.db
      .prepare(
        `UPDATE subscriptions
         SET status = ?, modified_at = CURRENT_TIMESTAMP
         WHERE subscription_id = ?`,
      )
      .bind(status, subscriptionId)
      .run()
  }
}
