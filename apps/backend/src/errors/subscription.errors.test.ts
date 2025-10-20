import { describe, expect, it } from "bun:test"
import { SubscriptionStatus } from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import {
  getSubscriptionStatusFromError,
  isExposableError,
  isRetryablePaymentError,
  isTerminalSubscriptionError,
  isUpstreamServiceError,
} from "./subscription.errors"

describe("Error Classification", () => {
  describe("isRetryablePaymentError", () => {
    it("returns true for INSUFFICIENT_BALANCE errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )
      expect(isRetryablePaymentError(error)).toBe(true)
    })

    it("returns false for PERMISSION_REVOKED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PERMISSION_REVOKED,
        "Permission revoked",
      )
      expect(isRetryablePaymentError(error)).toBe(false)
    })

    it("returns false for PERMISSION_EXPIRED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PERMISSION_EXPIRED,
        "Permission expired",
      )
      expect(isRetryablePaymentError(error)).toBe(false)
    })

    it("returns false for PAYMENT_FAILED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PAYMENT_FAILED,
        "Payment failed",
      )
      expect(isRetryablePaymentError(error)).toBe(false)
    })

    it("returns false for generic errors", () => {
      const error = new Error("Generic error")
      expect(isRetryablePaymentError(error)).toBe(false)
    })

    it("returns false for non-error values", () => {
      expect(isRetryablePaymentError(null)).toBe(false)
      expect(isRetryablePaymentError(undefined)).toBe(false)
      expect(isRetryablePaymentError("string")).toBe(false)
      expect(isRetryablePaymentError(123)).toBe(false)
    })
  })

  describe("isUpstreamServiceError", () => {
    it("returns true for UPSTREAM_SERVICE_ERROR errors", () => {
      const error = new HTTPError(
        503,
        ErrorCode.UPSTREAM_SERVICE_ERROR,
        "Service unavailable",
      )
      expect(isUpstreamServiceError(error)).toBe(true)
    })

    it("returns false for INSUFFICIENT_BALANCE errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )
      expect(isUpstreamServiceError(error)).toBe(false)
    })

    it("returns false for PERMISSION_REVOKED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PERMISSION_REVOKED,
        "Permission revoked",
      )
      expect(isUpstreamServiceError(error)).toBe(false)
    })

    it("returns false for PAYMENT_FAILED errors", () => {
      const error = new HTTPError(
        500,
        ErrorCode.PAYMENT_FAILED,
        "Payment failed",
      )
      expect(isUpstreamServiceError(error)).toBe(false)
    })

    it("returns false for INTERNAL_ERROR errors", () => {
      const error = new HTTPError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "Internal error",
      )
      expect(isUpstreamServiceError(error)).toBe(false)
    })

    it("returns false for generic errors", () => {
      const error = new Error("Generic error")
      expect(isUpstreamServiceError(error)).toBe(false)
    })

    it("returns false for non-error values", () => {
      expect(isUpstreamServiceError(null)).toBe(false)
      expect(isUpstreamServiceError(undefined)).toBe(false)
      expect(isUpstreamServiceError("string")).toBe(false)
      expect(isUpstreamServiceError(123)).toBe(false)
    })
  })

  describe("isTerminalSubscriptionError", () => {
    it("returns true for PERMISSION_REVOKED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PERMISSION_REVOKED,
        "Permission revoked",
      )
      expect(isTerminalSubscriptionError(error)).toBe(true)
    })

    it("returns true for PERMISSION_EXPIRED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PERMISSION_EXPIRED,
        "Permission expired",
      )
      expect(isTerminalSubscriptionError(error)).toBe(true)
    })

    it("returns false for INSUFFICIENT_BALANCE errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )
      expect(isTerminalSubscriptionError(error)).toBe(false)
    })

    it("returns false for PAYMENT_FAILED errors", () => {
      const error = new HTTPError(
        402,
        ErrorCode.PAYMENT_FAILED,
        "Payment failed",
      )
      expect(isTerminalSubscriptionError(error)).toBe(false)
    })

    it("returns false for generic errors", () => {
      const error = new Error("Generic error")
      expect(isTerminalSubscriptionError(error)).toBe(false)
    })

    it("returns false for non-error values", () => {
      expect(isTerminalSubscriptionError(null)).toBe(false)
      expect(isTerminalSubscriptionError(undefined)).toBe(false)
      expect(isTerminalSubscriptionError("string")).toBe(false)
    })
  })

  describe("getSubscriptionStatusFromError", () => {
    it("returns CANCELED for PERMISSION_REVOKED", () => {
      expect(getSubscriptionStatusFromError(ErrorCode.PERMISSION_REVOKED)).toBe(
        SubscriptionStatus.CANCELED,
      )
    })

    it("returns CANCELED for PERMISSION_EXPIRED", () => {
      expect(getSubscriptionStatusFromError(ErrorCode.PERMISSION_EXPIRED)).toBe(
        SubscriptionStatus.CANCELED,
      )
    })

    it("returns PAST_DUE for INSUFFICIENT_BALANCE", () => {
      expect(
        getSubscriptionStatusFromError(ErrorCode.INSUFFICIENT_BALANCE),
      ).toBe(SubscriptionStatus.PAST_DUE)
    })

    it("returns ACTIVE for PAYMENT_FAILED", () => {
      expect(getSubscriptionStatusFromError(ErrorCode.PAYMENT_FAILED)).toBe(
        SubscriptionStatus.ACTIVE,
      )
    })

    it("returns ACTIVE for INTERNAL_ERROR", () => {
      expect(getSubscriptionStatusFromError(ErrorCode.INTERNAL_ERROR)).toBe(
        SubscriptionStatus.ACTIVE,
      )
    })

    it("returns ACTIVE for undefined error code", () => {
      expect(getSubscriptionStatusFromError(undefined)).toBe(
        SubscriptionStatus.ACTIVE,
      )
    })

    it("returns ACTIVE for unknown error code", () => {
      expect(getSubscriptionStatusFromError("UNKNOWN_ERROR")).toBe(
        SubscriptionStatus.ACTIVE,
      )
    })
  })

  describe("isExposableError", () => {
    it("returns true for 402 HTTPErrors (payment errors)", () => {
      const insufficientBalance = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )
      const permissionRevoked = new HTTPError(
        402,
        ErrorCode.PERMISSION_REVOKED,
        "Permission revoked",
      )
      const permissionExpired = new HTTPError(
        402,
        ErrorCode.PERMISSION_EXPIRED,
        "Permission expired",
      )
      const paymentFailed = new HTTPError(
        402,
        ErrorCode.PAYMENT_FAILED,
        "Payment failed",
      )

      expect(isExposableError(insufficientBalance)).toBe(true)
      expect(isExposableError(permissionRevoked)).toBe(true)
      expect(isExposableError(permissionExpired)).toBe(true)
      expect(isExposableError(paymentFailed)).toBe(true)
    })

    it("returns false for 500 HTTPErrors (system errors)", () => {
      const error = new HTTPError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "Internal error",
      )
      expect(isExposableError(error)).toBe(false)
    })

    it("returns false for generic errors", () => {
      const error = new Error("Generic error")
      expect(isExposableError(error)).toBe(false)
    })

    it("returns false for non-error values", () => {
      expect(isExposableError(null)).toBe(false)
      expect(isExposableError(undefined)).toBe(false)
      expect(isExposableError("string")).toBe(false)
    })
  })
})
