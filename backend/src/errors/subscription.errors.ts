import { SubscriptionStatus } from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"

/**
 * Payment error classification utilities for subscription service
 */

/**
 * Error code to user-friendly message mapping
 */
const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.INSUFFICIENT_BALANCE]:
    "Insufficient balance to complete the payment",
  [ErrorCode.PERMISSION_EXPIRED]: "Subscription permission has expired",
  [ErrorCode.PERMISSION_REVOKED]: "Subscription permission has been revoked",
  [ErrorCode.USER_OPERATION_FAILED]: "User operation failed",
  [ErrorCode.PAYMENT_FAILED]: "Payment failed",
}

/**
 * Checks if an error should be exposed to merchants in webhooks.
 * Uses HTTP semantics: 402 Payment Required indicates a payment error.
 * Payment errors are exposed with details, system errors are sanitized.
 */
export function isExposableError(error: unknown): error is HTTPError {
  return error instanceof HTTPError && error.status === 402
}

/**
 * Only INSUFFICIENT_BALANCE is retryable via dunning.
 * User might add funds over the 21-day retry period.
 */
export function isRetryablePaymentError(error: unknown): boolean {
  return (
    error instanceof HTTPError && error.code === ErrorCode.INSUFFICIENT_BALANCE
  )
}

/**
 * Upstream service errors are infrastructure failures from external providers.
 * These are retryable via queue mechanism with exponential backoff.
 * Examples: CDP/Base SDK 5xx errors, timeouts, service unavailable
 */
export function isUpstreamServiceError(error: unknown): boolean {
  return (
    error instanceof HTTPError &&
    error.code === ErrorCode.UPSTREAM_SERVICE_ERROR
  )
}

/**
 * User operation failed errors - bundler rejected during simulation.
 * Common causes: duplicate charge, insufficient balance, nonce conflicts.
 * In batch processing, don't create next order to prevent cascade duplication.
 */
export function isUserOperationFailedError(error: unknown): boolean {
  return (
    error instanceof HTTPError && error.code === ErrorCode.USER_OPERATION_FAILED
  )
}

/**
 * Terminal subscription errors - subscription cannot continue.
 * Mark as UNPAID immediately without retry.
 */
export function isTerminalSubscriptionError(error: unknown): boolean {
  return (
    error instanceof HTTPError &&
    (error.code === ErrorCode.PERMISSION_REVOKED ||
      error.code === ErrorCode.PERMISSION_EXPIRED)
  )
}

/**
 * Gets user-friendly error message for an error code
 */
export function getErrorMessage(errorCode: ErrorCode): string {
  return ERROR_MESSAGES[errorCode] || "An error occurred"
}

/**
 * Maps error code to subscription status for webhooks.
 * Determines the correct subscription state based on payment failure type.
 *
 * CANCELED: Permission revoked/expired - non-recoverable, requires new permission onchain
 * PAST_DUE: Insufficient balance - recoverable via dunning retries
 * ACTIVE: Other errors - system/provider errors, subscription continues
 */
export function getSubscriptionStatusFromError(
  errorCode: string | undefined,
): SubscriptionStatus {
  if (
    errorCode === ErrorCode.PERMISSION_REVOKED ||
    errorCode === ErrorCode.PERMISSION_EXPIRED
  ) {
    return SubscriptionStatus.CANCELED // Terminal - subscription cannot continue
  }

  if (errorCode === ErrorCode.INSUFFICIENT_BALANCE) {
    return SubscriptionStatus.PAST_DUE // Retrying via dunning
  }

  return SubscriptionStatus.ACTIVE // Other errors - subscription continues
}
