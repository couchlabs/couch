/**
 * Repository-level constants for subscription data
 *
 * IMPORTANT: These values MUST match the CHECK constraints in the database schema
 * See: apps/backend/migrations/0001_init_subscription_billing_schema.sql
 *
 * When modifying these enums:
 * 1. Update the corresponding CHECK constraint in the SQL migration
 * 2. Create a new migration if the database is already deployed
 * 3. Ensure all values are lowercase to match DB constraints
 */

export enum SubscriptionStatus {
  PROCESSING = "processing",
  ACTIVE = "active",
  INACTIVE = "inactive",
}

export enum BillingType {
  RECURRING = "recurring",
  RETRY = "retry",
}

export enum BillingStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum TransactionStatus {
  PENDING = "pending",
  CONFIRMED = "confirmed",
  FAILED = "failed",
}
