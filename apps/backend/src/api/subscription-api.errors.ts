import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import type { PaymentErrorCode } from "@/services/subscription.service.errors"

export enum ErrorCode {
  // Client errors (4xx)
  INVALID_REQUEST = "INVALID_REQUEST",
  SUBSCRIPTION_EXISTS = "SUBSCRIPTION_EXISTS",
  PERMISSION_NOT_ACTIVE = "PERMISSION_NOT_ACTIVE",
  PAYMENT_FAILED = "PAYMENT_FAILED",

  // Server errors (5xx)
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class APIException extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    message: string,
    public code: ErrorCode | PaymentErrorCode | string,
    public details?: unknown,
    cause?: unknown,
  ) {
    const response = new Response(
      JSON.stringify({
        error: message,
        code,
        ...(details && { details }),
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )

    super(status, { res: response, message, cause })
  }
}

export const APIErrors = {
  invalidRequest: (message: string) =>
    new APIException(400, message, ErrorCode.INVALID_REQUEST),

  subscriptionExists: (subscriptionId?: string) =>
    new APIException(
      409,
      "Subscription already exists",
      ErrorCode.SUBSCRIPTION_EXISTS,
      subscriptionId ? { subscriptionId } : undefined,
    ),

  permissionNotActive: (subscriptionId?: string) =>
    new APIException(
      422,
      "Permission not active",
      ErrorCode.PERMISSION_NOT_ACTIVE,
      subscriptionId ? { subscriptionId } : undefined,
    ),

  paymentFailed: (
    errorCode: PaymentErrorCode,
    details?: any,
    cause?: unknown,
  ) => new APIException(402, "Payment failed", errorCode, details, cause),
}
