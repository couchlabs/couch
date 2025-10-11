import {
  calculateNextRetryDate,
  DUNNING_CONFIG,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import {
  isRetryablePaymentError,
  isTerminalSubscriptionError,
} from "@/errors/subscription.errors"

/**
 * Dunning action decision result
 */
export type DunningAction =
  | {
      type: "terminal"
      subscriptionStatus: SubscriptionStatus.CANCELED
      scheduleRetry: false
      createNextOrder: false
    }
  | {
      type: "retry"
      subscriptionStatus: SubscriptionStatus.PAST_DUE
      scheduleRetry: true
      createNextOrder: false
      nextRetryAt: Date
      attemptNumber: number
      attemptLabel: string
    }
  | {
      type: "max_retries_exhausted"
      subscriptionStatus: SubscriptionStatus.UNPAID
      scheduleRetry: false
      createNextOrder: false
    }
  | {
      type: "other_error"
      subscriptionStatus: SubscriptionStatus.ACTIVE
      scheduleRetry: false
      createNextOrder: true
    }

export interface DunningDecisionInput {
  error: unknown
  currentAttempts: number
  failureDate: Date
}

/**
 * Pure function to decide dunning action based on error type and attempts
 * No side effects - just decision logic
 */
export function decideDunningAction(
  input: DunningDecisionInput,
): DunningAction {
  const { error, currentAttempts, failureDate } = input

  // CASE 1: TERMINAL (revoked/expired) - mark CANCELED
  if (isTerminalSubscriptionError(error)) {
    return {
      type: "terminal",
      subscriptionStatus: SubscriptionStatus.CANCELED,
      scheduleRetry: false,
      createNextOrder: false,
    }
  }

  // CASE 2: RETRYABLE (insufficient balance) - check retry limit
  if (isRetryablePaymentError(error)) {
    if (currentAttempts < DUNNING_CONFIG.MAX_ATTEMPTS) {
      const nextRetryAt = calculateNextRetryDate(currentAttempts, failureDate)
      const attemptLabel =
        DUNNING_CONFIG.RETRY_INTERVALS[currentAttempts]?.label || "retry"

      return {
        type: "retry",
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        scheduleRetry: true,
        createNextOrder: false,
        nextRetryAt,
        attemptNumber: currentAttempts + 1,
        attemptLabel,
      }
    }

    // Max retries exhausted
    return {
      type: "max_retries_exhausted",
      subscriptionStatus: SubscriptionStatus.UNPAID,
      scheduleRetry: false,
      createNextOrder: false,
    }
  }

  // CASE 3: OTHER ERRORS - keep subscription ACTIVE, create next order
  return {
    type: "other_error",
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    scheduleRetry: false,
    createNextOrder: true,
  }
}
