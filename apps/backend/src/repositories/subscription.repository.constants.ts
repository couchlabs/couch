/**
 * Repository-level constants for subscription data
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
