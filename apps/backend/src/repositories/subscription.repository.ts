import { D1Database } from "@cloudflare/workers-types"

import {
  SubscriptionStatus,
  BillingType,
  BillingStatus,
  TransactionStatus,
} from "@/repositories/subscription.repository.constants"

import type { Hash, Address } from "viem"

export interface Subscription {
  subscription_id: string
  status: SubscriptionStatus
  account_address: string
  created_at?: string
  modified_at?: string
}

export interface BillingEntry {
  id?: number
  subscription_id: string
  type: BillingType
  due_at: string
  amount: string
  status: BillingStatus
  attempts?: number
  parent_billing_id?: number
  failure_reason?: string
  processing_lock?: string
  locked_by?: string
  created_at?: string
}

export interface Transaction {
  transaction_hash: string
  billing_entry_id: number
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
  accountAddress: Address
}

export interface SubscriptionExistsParams {
  subscriptionId: Hash
}

export interface GetSuccessfulTransactionParams {
  subscriptionId: Hash
  billingEntryId: number
}

export interface TransactionResult {
  transaction_hash: Hash
  billing_entry_id: number
  subscription_id: Hash
  amount: string
  status: TransactionStatus
  failure_reason?: string
  gas_used?: string
  created_at?: string
}

export interface DueBillingEntry {
  id: number
  subscription_id: Hash
  amount: string
  due_at: string
  attempts: number
}

export interface RecordTransactionParams {
  transactionHash: Hash
  billingEntryId: number
  subscriptionId: Hash
  amount: string
  status: string
}

export interface UpdateBillingEntryParams {
  id: number
  status: BillingStatus
  failureReason?: string
}

export interface UpdateSubscriptionParams {
  subscriptionId: Hash
  status: string
}

export interface DeleteSubscriptionDataParams {
  subscriptionId: Hash
}

export interface CreateSubscriptionWithBillingParams {
  subscriptionId: Hash
  accountAddress: Address
  billingEntry: BillingEntry
}

export interface ExecuteSubscriptionActivationParams {
  subscriptionId: Hash
  billingEntry: {
    id: number
  }
  transaction: {
    hash: Hash
    amount: string
  }
  nextBilling: {
    dueAt: string
    amount: string
  }
}

export interface MarkSubscriptionInactiveParams {
  subscriptionId: Hash
  billingEntryId: number
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
    const { subscriptionId, accountAddress } = params
    // Use INSERT OR IGNORE to handle race conditions atomically
    // This ensures only one request can create the subscription
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO subscriptions (subscription_id, account_address, status)
         VALUES (?, ?, ?)`,
      )
      .bind(subscriptionId, accountAddress, SubscriptionStatus.PROCESSING)
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

  async createBillingEntry(entry: BillingEntry): Promise<number> {
    const result = await this.db
      .prepare(
        `INSERT INTO billing_entries (
          subscription_id, type, due_at, amount, status
        ) VALUES (?, ?, ?, ?, ?)
        RETURNING id`,
      )
      .bind(
        entry.subscription_id,
        entry.type,
        entry.due_at,
        entry.amount,
        entry.status || BillingStatus.PROCESSING,
      )
      .first<{ id: number }>()

    return result!.id
  }

  async completeBillingEntry(id: number): Promise<void> {
    await this.db
      .prepare(`UPDATE billing_entries SET status = ? WHERE id = ?`)
      .bind(BillingStatus.COMPLETED, id)
      .run()
  }

  async failBillingEntry(id: number, reason: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE billing_entries
         SET status = ?, failure_reason = ?
         WHERE id = ?`,
      )
      .bind(BillingStatus.FAILED, reason, id)
      .run()
  }

  async createTransaction(transaction: Transaction): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO transactions (
          transaction_hash, billing_entry_id, subscription_id, amount, status
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        transaction.transaction_hash, // transaction_hash first as it's the PK
        transaction.billing_entry_id,
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
    const { subscriptionId, billingEntryId } = params
    const transaction = await this.db
      .prepare(
        `SELECT * FROM transactions
         WHERE subscription_id = ?
         AND billing_entry_id = ?
         AND status = ?
         LIMIT 1`,
      )
      .bind(subscriptionId, billingEntryId, TransactionStatus.CONFIRMED)
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
        .prepare("DELETE FROM billing_entries WHERE subscription_id = ?")
        .bind(subscriptionId),
      this.db
        .prepare("DELETE FROM subscriptions WHERE subscription_id = ?")
        .bind(subscriptionId),
    ])
  }

  /**
   * TRANSACTION: Create subscription and initial billing entry atomically
   * This ensures we either create both or neither
   */
  async createSubscriptionWithBilling(
    params: CreateSubscriptionWithBillingParams,
  ): Promise<{ created: boolean; billingEntryId?: number }> {
    const { subscriptionId, accountAddress, billingEntry } = params
    try {
      // D1 supports transactions via batch
      // First, check if subscription exists
      const exists = await this.subscriptionExists({ subscriptionId })
      if (exists) {
        return { created: false }
      }

      // Create subscription
      const subResult = await this.db
        .prepare(
          `INSERT INTO subscriptions (subscription_id, account_address, status)
           VALUES (?, ?, ?)`,
        )
        .bind(subscriptionId, accountAddress, SubscriptionStatus.PROCESSING)
        .run()

      if (subResult.meta.changes === 0) {
        // Race condition - another request created it
        return { created: false }
      }

      // Create billing entry
      const billingResult = await this.db
        .prepare(
          `INSERT INTO billing_entries (
            subscription_id, type, due_at, amount, status
          ) VALUES (?, ?, ?, ?, ?)
          RETURNING id`,
        )
        .bind(
          billingEntry.subscription_id,
          billingEntry.type,
          billingEntry.due_at,
          billingEntry.amount,
          billingEntry.status || BillingStatus.PROCESSING,
        )
        .first<{ id: number }>()

      return { created: true, billingEntryId: billingResult!.id }
    } catch (error) {
      // If anything fails, clean up
      await this.deleteSubscriptionData({ subscriptionId })
      throw error
    }
  }

  /**
   * TRANSACTION: Finalize subscription activation
   * Updates subscription status, billing entry, creates transaction, and next billing
   */
  async executeSubscriptionActivation(
    params: ExecuteSubscriptionActivationParams,
  ): Promise<void> {
    const { subscriptionId, billingEntry, transaction, nextBilling } = params
    await this.db.batch([
      // Create transaction record
      this.db
        .prepare(
          `INSERT INTO transactions (
            transaction_hash, billing_entry_id, subscription_id, amount, status
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          transaction.hash, // transaction_hash column (PK)
          billingEntry.id,
          subscriptionId,
          transaction.amount,
          TransactionStatus.CONFIRMED,
        ),
      // Mark billing entry as completed
      this.db
        .prepare(`UPDATE billing_entries SET status = ? WHERE id = ?`)
        .bind(BillingStatus.COMPLETED, billingEntry.id),
      // Create next billing entry
      this.db
        .prepare(
          `INSERT INTO billing_entries (
            subscription_id, type, due_at, amount, status
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          subscriptionId,
          BillingType.RECURRING,
          nextBilling.dueAt,
          nextBilling.amount,
          BillingStatus.PENDING,
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
    const { subscriptionId, billingEntryId, reason } = params
    await this.db.batch([
      // Mark subscription as inactive
      this.db
        .prepare(
          `UPDATE subscriptions
           SET status = ?, modified_at = CURRENT_TIMESTAMP
           WHERE subscription_id = ?`,
        )
        .bind(SubscriptionStatus.INACTIVE, subscriptionId),
      // Mark billing entry as failed
      this.db
        .prepare(
          `UPDATE billing_entries
           SET status = ?, failure_reason = ?
           WHERE id = ?`,
        )
        .bind(BillingStatus.FAILED, reason, billingEntryId),
    ])
  }

  /**
   * Atomically claim due billing entries for processing
   * This prevents race conditions between multiple schedulers
   */
  async claimDueBillingEntries(
    limit: number = 100,
  ): Promise<DueBillingEntry[]> {
    const result = await this.db
      .prepare(
        `UPDATE billing_entries
         SET status = ?
         WHERE id IN (
           SELECT be.id
           FROM billing_entries be
           JOIN subscriptions s ON be.subscription_id = s.subscription_id
           WHERE be.status = ?
             AND be.due_at <= datetime('now')
             AND s.status = ?
           ORDER BY be.due_at
           LIMIT ?
         )
         RETURNING id, subscription_id, amount, due_at, attempts`,
      )
      .bind(BillingStatus.PROCESSING, BillingStatus.PENDING, "active", limit)
      .all<DueBillingEntry>()

    return (result.results || []).map((entry) => ({
      id: entry.id,
      subscription_id: entry.subscription_id as Hash,
      amount: entry.amount,
      due_at: entry.due_at,
      attempts: entry.attempts,
    }))
  }

  /**
   * Record a transaction for a billing entry
   */
  async recordTransaction(params: RecordTransactionParams): Promise<void> {
    const { transactionHash, billingEntryId, subscriptionId, amount, status } =
      params

    await this.db
      .prepare(
        `INSERT INTO transactions (
          transaction_hash, billing_entry_id, subscription_id, amount, status
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(transactionHash, billingEntryId, subscriptionId, amount, status)
      .run()
  }

  /**
   * Update billing entry status
   */
  async updateBillingEntry(params: UpdateBillingEntryParams): Promise<void> {
    const { id, status, failureReason } = params

    if (failureReason) {
      await this.db
        .prepare(
          `UPDATE billing_entries
           SET status = ?, failure_reason = ?
           WHERE id = ?`,
        )
        .bind(status, failureReason, id)
        .run()
    } else {
      await this.db
        .prepare(
          `UPDATE billing_entries
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
