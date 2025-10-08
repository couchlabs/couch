import { ErrorCode, HTTPError } from "@/errors/http.errors"

/**
 * Payment error mapping utilities for subscription service
 */

/**
 * Error code to user-friendly message mapping
 */
const ERROR_MESSAGES: Record<string, string> = {
  [ErrorCode.INSUFFICIENT_BALANCE]:
    "Insufficient balance to complete the payment",
  [ErrorCode.PERMISSION_EXPIRED]: "Subscription permission has expired",
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
 * Gets the appropriate error code for a payment/blockchain error.
 * Maps blockchain error messages to our error codes.
 * Only returns user-actionable error codes when appropriate.
 */
export function getPaymentErrorCode(error: Error): ErrorCode {
  const message = error.message.toLowerCase()

  // User-actionable errors that should be exposed
  if (
    message.includes("erc20: transfer amount exceeds balance") ||
    message.includes("insufficient balance") ||
    message.includes("not enough")
  ) {
    return ErrorCode.INSUFFICIENT_BALANCE
  }

  if (message.includes("expired")) {
    return ErrorCode.PERMISSION_EXPIRED
  }

  // All other payment errors map to generic PAYMENT_FAILED
  // These are internal/technical issues that users can't directly fix:
  // - spending allowance issues (internal configuration)
  // - gas issues (internal wallet funding)
  // - revoked permissions (should be handled differently)
  // - generic permission errors (too vague to be actionable)
  return ErrorCode.PAYMENT_FAILED
}

/**
 * Gets user-friendly error message for an error code
 */
export function getErrorMessage(errorCode: ErrorCode): string {
  return ERROR_MESSAGES[errorCode] || "An error occurred"
}
