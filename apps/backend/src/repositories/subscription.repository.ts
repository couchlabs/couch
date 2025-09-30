import { D1Database } from "@cloudflare/workers-types"

import {
  SubscriptionStatus,
  OrderType,
  OrderStatus,
  TransactionStatus,
} from "@/repositories/subscription.repository.constants"

import type { Hash, Address } from "viem"

export interface Subscription {
  subscription_id: string
  status: SubscriptionStatus
  owner_address: string
  created_at?: string
  modified_at?: string
}

export interface Order {
  id?: number
  subscription_id: string
  type: OrderType
  due_at: string
  amount: string
  status: OrderStatus
  attempts?: number
  parent_order_id?: number
  failure_reason?: string
  processing_lock?: string
  locked_by?: string
  created_at?: string
}

export interface Transaction {
  transaction_hash: string
  order_id: number
  subscription_id: string
  amount: string
  status: TransactionStatus
  failure_reason?: string
  gas_used?: string
  created_at?: string
}

// Method parameter interfaces
export interface CreateSubscriptionParams {
  subscriptionId: Hash
  ownerAddress: Address
}

export interface SubscriptionExistsParams {
  subscriptionId: Hash
}

export interface GetSuccessfulTransactionParams {
  subscriptionId: Hash
  orderId: number
}

export interface TransactionResult {
  transaction_hash: Hash
  order_id: number
  subscription_id: Hash
  amount: string
  status: TransactionStatus
  failure_reason?: string
  gas_used?: string
  created_at?: string
}

export interface DueOrder {
  id: number
  subscription_id: Hash
  amount: string
  due_at: string
  attempts: number
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
  order: Order
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
  }
}

export interface MarkSubscriptionInactiveParams {
  subscriptionId: Hash
  orderId: number
  reason: string
}

export class SubscriptionRepository {
  private db: D1Database

  constructor(config: { db: D1Database }) {
    this.db = config.db
  }

  /**
   * Creates a subscription record if it doesn't exist
   * Returns true if created, false if already exists
   * This is atomic - prevents race conditions
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<boolean> {
    const { subscriptionId, ownerAddress } = params
    // Use INSERT OR IGNORE to handle race conditions atomically
    // This ensures only one request can create the subscription
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO subscriptions (subscription_id, owner_address, status)
         VALUES (?, ?, ?)`,
      )
      .bind(subscriptionId, ownerAddress, SubscriptionStatus.PROCESSING)
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

  async getSubscription(subscriptionId: Hash): Promise<Subscription | null> {
    return await this.db
      .prepare("SELECT * FROM subscriptions WHERE subscription_id = ?")
      .bind(subscriptionId)
      .first()
  }

  async createOrder(order: Order): Promise<number> {
    const result = await this.db
      .prepare(
        `INSERT INTO orders (
          subscription_id, type, due_at, amount, status
        ) VALUES (?, ?, ?, ?, ?)
        RETURNING id`,
      )
      .bind(
        order.subscription_id,
        order.type,
        order.due_at,
        order.amount,
        order.status || OrderStatus.PROCESSING,
      )
      .first<{ id: number }>()

    return result!.id
  }

  async completeOrder(id: number): Promise<void> {
    await this.db
      .prepare(`UPDATE orders SET status = ? WHERE id = ?`)
      .bind(OrderStatus.PAID, id)
      .run()
  }

  async failOrder(id: number, reason: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE orders
         SET status = ?, failure_reason = ?
         WHERE id = ?`,
      )
      .bind(OrderStatus.FAILED, reason, id)
      .run()
  }

  async createTransaction(transaction: Transaction): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO transactions (
          transaction_hash, order_id, subscription_id, amount, status
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        transaction.transaction_hash, // transaction_hash first as it's the PK
        transaction.order_id,
        transaction.subscription_id,
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
  ): Promise<TransactionResult | null> {
    const { subscriptionId, orderId } = params
    const transaction = await this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE subscription_id = ?
         AND order_id = ?
         AND status = ?
         LIMIT 1`,
      )
      .bind(subscriptionId, orderId, TransactionStatus.CONFIRMED)
      .first<Transaction>()

    return transaction
      ? {
          ...transaction,
          subscription_id: transaction.subscription_id as Hash,
          transaction_hash: transaction.transaction_hash as Hash,
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
  ): Promise<{ created: boolean; orderId?: number }> {
    const { subscriptionId, ownerAddress, accountAddress, order } = params
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
          `INSERT INTO subscriptions (subscription_id, owner_address, status, account_address)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(
          subscriptionId,
          ownerAddress,
          SubscriptionStatus.PROCESSING,
          accountAddress,
        )
        .run()

      if (subResult.meta.changes === 0) {
        // Race condition - another request created it
        return { created: false }
      }

      // Create order
      const orderResult = await this.db
        .prepare(
          `INSERT INTO orders (
            subscription_id, type, due_at, amount, status
          ) VALUES (?, ?, ?, ?, ?)
          RETURNING id`,
        )
        .bind(
          order.subscription_id,
          order.type,
          order.due_at,
          order.amount,
          order.status || OrderStatus.PROCESSING,
        )
        .first<{ id: number }>()

      return { created: true, orderId: orderResult!.id }
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
      // Create next order
      this.db
        .prepare(
          `INSERT INTO orders (
            subscription_id, type, due_at, amount, status
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          subscriptionId,
          OrderType.RECURRING,
          nextOrder.dueAt,
          nextOrder.amount,
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
         RETURNING id, subscription_id, amount, due_at, attempts`,
      )
      .bind(OrderStatus.PROCESSING, OrderStatus.PENDING, "active", limit)
      .all<DueOrder>()

    return (result.results || []).map((entry) => ({
      id: entry.id,
      subscription_id: entry.subscription_id as Hash,
      amount: entry.amount,
      due_at: entry.due_at,
      attempts: entry.attempts,
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
   * Update order status
   */
  async updateOrder(params: UpdateOrderParams): Promise<void> {
    const { id, status, failureReason, rawError } = params

    if (failureReason || rawError) {
      await this.db
        .prepare(
          `UPDATE orders
           SET status = ?, failure_reason = ?, raw_error = ?
           WHERE id = ?`,
        )
        .bind(status, failureReason || null, rawError || null, id)
        .run()
    } else {
      await this.db
        .prepare(
          `UPDATE orders
           SET status = ?
           WHERE id = ?`,
        )
        .bind(status, id)
        .run()
    }
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
