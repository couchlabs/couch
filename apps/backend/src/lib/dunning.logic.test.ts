import { describe, expect, it } from "bun:test"
import { addDays, FIXED_DATE } from "@tests/test-utils"
import {
  DUNNING_CONFIG,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { decideDunningAction } from "./dunning.logic"

describe("decideDunningAction", () => {
  describe("Terminal errors (PERMISSION_REVOKED/EXPIRED)", () => {
    it("returns terminal action for PERMISSION_REVOKED", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.PERMISSION_REVOKED,
          "Permission revoked",
        ),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "terminal",
        subscriptionStatus: SubscriptionStatus.CANCELED,
        scheduleRetry: false,
        createNextOrder: false,
      })
    })

    it("returns terminal action for PERMISSION_EXPIRED", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.PERMISSION_EXPIRED,
          "Permission expired",
        ),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "terminal",
        subscriptionStatus: SubscriptionStatus.CANCELED,
        scheduleRetry: false,
        createNextOrder: false,
      })
    })

    it("returns terminal action regardless of attempt count", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.PERMISSION_REVOKED,
          "Permission revoked",
        ),
        currentAttempts: 3,
        failureDate: FIXED_DATE,
      })

      expect(result.type).toBe("terminal")
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.CANCELED)
    })
  })

  describe("Retryable errors (INSUFFICIENT_BALANCE) - within retry limit", () => {
    it("returns retry action for first attempt (attempt 0)", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "retry",
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        scheduleRetry: true,
        createNextOrder: false,
        nextRetryAt: addDays(FIXED_DATE, 2), // Day 2
        attemptNumber: 1,
        attemptLabel: "First retry",
      })
    })

    it("returns retry action for second attempt (attempt 1)", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: 1,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "retry",
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        scheduleRetry: true,
        createNextOrder: false,
        nextRetryAt: addDays(FIXED_DATE, 7), // Day 7 cumulative
        attemptNumber: 2,
        attemptLabel: "Second retry",
      })
    })

    it("returns retry action for third attempt (attempt 2)", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: 2,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "retry",
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        scheduleRetry: true,
        createNextOrder: false,
        nextRetryAt: addDays(FIXED_DATE, 14), // Day 14 cumulative
        attemptNumber: 3,
        attemptLabel: "Third retry",
      })
    })

    it("returns retry action for fourth attempt (attempt 3)", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: 3,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "retry",
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        scheduleRetry: true,
        createNextOrder: false,
        nextRetryAt: addDays(FIXED_DATE, 21), // Day 21 cumulative
        attemptNumber: 4,
        attemptLabel: "Final retry",
      })
    })
  })

  describe("Retryable errors - max retries exhausted", () => {
    it("returns max_retries_exhausted when currentAttempts = MAX_ATTEMPTS", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: DUNNING_CONFIG.MAX_ATTEMPTS,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "max_retries_exhausted",
        subscriptionStatus: SubscriptionStatus.UNPAID,
        scheduleRetry: false,
        createNextOrder: false,
      })
    })

    it("returns max_retries_exhausted when currentAttempts > MAX_ATTEMPTS", () => {
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: DUNNING_CONFIG.MAX_ATTEMPTS + 1,
        failureDate: FIXED_DATE,
      })

      expect(result.type).toBe("max_retries_exhausted")
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.UNPAID)
    })
  })

  describe("Other errors (system/provider errors)", () => {
    it("returns other_error action for PAYMENT_FAILED", () => {
      const result = decideDunningAction({
        error: new HTTPError(402, ErrorCode.PAYMENT_FAILED, "Payment failed"),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "other_error",
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        scheduleRetry: false,
        createNextOrder: true,
      })
    })

    it("returns other_error action for INTERNAL_ERROR", () => {
      const result = decideDunningAction({
        error: new HTTPError(500, ErrorCode.INTERNAL_ERROR, "Internal error"),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "other_error",
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        scheduleRetry: false,
        createNextOrder: true,
      })
    })

    it("returns other_error action for generic errors", () => {
      const result = decideDunningAction({
        error: new Error("Generic error"),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result).toEqual({
        type: "other_error",
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        scheduleRetry: false,
        createNextOrder: true,
      })
    })

    it("returns other_error action regardless of attempt count", () => {
      const result = decideDunningAction({
        error: new HTTPError(402, ErrorCode.PAYMENT_FAILED, "Payment failed"),
        currentAttempts: 5,
        failureDate: FIXED_DATE,
      })

      expect(result.type).toBe("other_error")
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE)
    })
  })

  describe("Decision priority (error type hierarchy)", () => {
    it("terminal errors take precedence over retry count", () => {
      // Even with 0 attempts (could retry), terminal error cancels subscription
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.PERMISSION_REVOKED,
          "Permission revoked",
        ),
        currentAttempts: 0,
        failureDate: FIXED_DATE,
      })

      expect(result.type).toBe("terminal")
    })

    it("retryable errors respect attempt limits", () => {
      // Retryable error at max attempts becomes unpaid
      const result = decideDunningAction({
        error: new HTTPError(
          402,
          ErrorCode.INSUFFICIENT_BALANCE,
          "Insufficient balance",
        ),
        currentAttempts: DUNNING_CONFIG.MAX_ATTEMPTS,
        failureDate: FIXED_DATE,
      })

      expect(result.type).toBe("max_retries_exhausted")
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.UNPAID)
    })

    it("other errors always keep subscription active", () => {
      // Even with many attempts, other errors keep subscription active
      const result = decideDunningAction({
        error: new Error("Generic error"),
        currentAttempts: 10,
        failureDate: FIXED_DATE,
      })

      expect(result.type).toBe("other_error")
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE)
    })
  })
})
