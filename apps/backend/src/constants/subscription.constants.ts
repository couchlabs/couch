/**
 * Repository-level constants for subscription and order data
 *
 * IMPORTANT: These values MUST match the CHECK constraints in the database schema
 * See: apps/backend/migrations/0001_init_subscription_order_schema.sql
 *
 * When modifying these enums:
 * 1. Update the corresponding CHECK constraint in the SQL migration
 * 2. Create a new migration if the database is already deployed
 * 3. Ensure all values are lowercase to match DB constraints
 */

export enum SubscriptionStatus {
  PROCESSING = "processing",
  ACTIVE = "active",
  PAST_DUE = "past_due",
  INCOMPLETE = "incomplete",
  CANCELED = "canceled",
  UNPAID = "unpaid",
}

export enum OrderType {
  INITIAL = "initial",
  RECURRING = "recurring",
  RETRY = "retry",
}

export enum OrderStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  PAID = "paid",
  FAILED = "failed",
  PENDING_RETRY = "pending_retry",
}

export enum TransactionStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  FAILED = "failed",
}

/**
 * Dunning (payment retry) configuration
 * Defines retry schedule for recurring payment failures
 */
export const DUNNING_CONFIG = {
  RETRY_INTERVALS: [
    { days: 2, label: "First retry" }, // Day 2
    { days: 5, label: "Second retry" }, // Day 7 (cumulative)
    { days: 7, label: "Third retry" }, // Day 14 (cumulative)
    { days: 7, label: "Final retry" }, // Day 21 (cumulative)
  ],
  MAX_ATTEMPTS: 4,
  CRON_SCHEDULE: "0 * * * *", // Hourly
} as const

export function calculateNextRetryDate(
  attempt: number,
  failureDate: Date,
): Date {
  if (attempt >= DUNNING_CONFIG.MAX_ATTEMPTS) {
    throw new Error("Max retry attempts exceeded")
  }

  const cumulativeDays = DUNNING_CONFIG.RETRY_INTERVALS.slice(
    0,
    attempt + 1,
  ).reduce((sum, interval) => sum + interval.days, 0)

  const nextRetry = new Date(failureDate)
  nextRetry.setDate(nextRetry.getDate() + cumulativeDays)
  return nextRetry
}
