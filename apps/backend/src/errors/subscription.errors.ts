/**
 * Payment error mapping utilities for subscription service
 */

import { ErrorCode } from "@/errors/http.errors"

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
