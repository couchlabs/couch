import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"

// Error codes catalog
export const ErrorCode = {
  // Request errors (4xx)
  INVALID_REQUEST: "INVALID_REQUEST",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_FORMAT: "INVALID_FORMAT",

  // Auth errors (4xx)
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_API_KEY: "INVALID_API_KEY",
  FORBIDDEN: "FORBIDDEN",

  // Subscription/Payment errors (4xx)
  SUBSCRIPTION_EXISTS: "SUBSCRIPTION_EXISTS",
  SUBSCRIPTION_NOT_ACTIVE: "SUBSCRIPTION_NOT_ACTIVE",
  PERMISSION_NOT_FOUND: "PERMISSION_NOT_FOUND",
  PERMISSION_EXPIRED: "PERMISSION_EXPIRED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",

  // User-actionable payment errors
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE", // User needs to add funds

  // Generic payment error (for internal issues we don't expose)
  PAYMENT_FAILED: "PAYMENT_FAILED",

  // System errors (5xx)
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// Additional error details that can be attached to HTTPError
// Used for debugging and providing extra context
export interface ErrorDetails {
  originalError?: string
  subscriptionId?: string
}

// HTTPError class that extends HTTPException with consistent JSON format
export class HTTPError extends HTTPException {
  public readonly code: ErrorCode
  public readonly details?: ErrorDetails

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    details?: ErrorDetails,
  ) {
    // Create consistent JSON response body
    const res = new Response(
      JSON.stringify({
        error: message,
        code,
        ...(details != null && { details }),
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    )

    // Call parent constructor with both res and message
    // - message: for proper error.message property
    // - res: for custom JSON response body
    super(status, { res, message })
    this.code = code
    this.details = details
  }
}
