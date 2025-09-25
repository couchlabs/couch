/**
 * Subscription service specific errors
 */

/**
 * Error codes for payment/charge failures
 * These codes are returned to the client for proper error handling and i18n
 */
export enum PaymentErrorCode {
  INSUFFICIENT_USDC_BALANCE = "INSUFFICIENT_USDC_BALANCE",
  INSUFFICIENT_SPENDING_ALLOWANCE = "INSUFFICIENT_SPENDING_ALLOWANCE",
  PERMISSION_REVOKED = "PERMISSION_REVOKED",
  PERMISSION_EXPIRED = "PERMISSION_EXPIRED",
  INSUFFICIENT_GAS = "INSUFFICIENT_GAS",
  GENERIC_PERMISSION_ERROR = "GENERIC_PERMISSION_ERROR",
  UNKNOWN_PAYMENT_ERROR = "UNKNOWN_PAYMENT_ERROR",
}

export class SubscriptionError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown,
  ) {
    super(message)
    this.name = "SubscriptionError"
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }
}

export class InvalidSubscriptionStateError extends SubscriptionError {
  constructor(message: string, cause?: unknown) {
    super(message, "INVALID_SUBSCRIPTION_STATE", cause)
  }
}

export class MissingRequiredFieldError extends SubscriptionError {
  constructor(fieldName: string, cause?: unknown) {
    super(
      `Required field '${fieldName}' is missing or undefined`,
      "MISSING_REQUIRED_FIELD",
      cause,
    )
  }
}

export class InsufficientChargeError extends SubscriptionError {
  constructor(
    public required: string,
    public available?: string,
    cause?: unknown,
  ) {
    super(
      `Insufficient charge amount. Required: ${required}, Available: ${available || "unknown"}`,
      "INSUFFICIENT_CHARGE",
      cause,
    )
  }
}

export class UnauthorizedSpenderError extends SubscriptionError {
  constructor(
    public expected: string,
    public actual: string,
    cause?: unknown,
  ) {
    super(
      `Unauthorized spender. Expected: ${expected}, Actual: ${actual}`,
      "UNAUTHORIZED_SPENDER",
      cause,
    )
  }
}

/**
 * Factory functions for common subscription errors
 */
export const SubscriptionErrors = {
  invalidState: (message: string, cause?: unknown) =>
    new InvalidSubscriptionStateError(message, cause),

  missingField: (fieldName: string, cause?: unknown) =>
    new MissingRequiredFieldError(fieldName, cause),

  insufficientCharge: (required: string, available?: string, cause?: unknown) =>
    new InsufficientChargeError(required, available, cause),

  unauthorizedSpender: (expected: string, actual: string, cause?: unknown) =>
    new UnauthorizedSpenderError(expected, actual, cause),

  missingSubscriptionOwner: () =>
    new MissingRequiredFieldError("subscriptionOwner"),

  missingRemainingCharge: () =>
    new MissingRequiredFieldError("remainingChargeInPeriod"),

  missingNextPeriodStart: () =>
    new MissingRequiredFieldError("nextPeriodStart"),

  missingRecurringCharge: () =>
    new MissingRequiredFieldError("recurringCharge"),
}

/**
 * Gets the appropriate error code for a payment/blockchain error
 * Frontend will map these codes to user-friendly messages in the appropriate language
 */
export function getPaymentErrorCode(error: Error): PaymentErrorCode {
  const message = error.message.toLowerCase()

  // Check for spending allowance issues
  if (message.includes("remaining spend amount is insufficient")) {
    return PaymentErrorCode.INSUFFICIENT_SPENDING_ALLOWANCE
  }

  // Check for balance issues
  if (
    message.includes("erc20: transfer amount exceeds balance") ||
    message.includes("insufficient balance") ||
    message.includes("not enough")
  ) {
    return PaymentErrorCode.INSUFFICIENT_USDC_BALANCE
  }

  // Check for permission issues
  if (message.includes("revoked")) {
    return PaymentErrorCode.PERMISSION_REVOKED
  }

  if (message.includes("expired")) {
    return PaymentErrorCode.PERMISSION_EXPIRED
  }

  // Check for gas issues
  if (message.includes("gas") && !message.includes("erc20")) {
    return PaymentErrorCode.INSUFFICIENT_GAS
  }

  // Generic permission issues
  if (message.includes("permission")) {
    return PaymentErrorCode.GENERIC_PERMISSION_ERROR
  }

  // Return unknown error code if no mapping found
  return PaymentErrorCode.UNKNOWN_PAYMENT_ERROR
}
