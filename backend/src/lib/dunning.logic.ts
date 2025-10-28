import {
  calculateNextRetryDate,
  getDunningConfig,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import {
  isRetryablePaymentError,
  isTerminalSubscriptionError,
  isUpstreamServiceError,
  isUserOperationFailedError,
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
      type: "upstream_error"
      subscriptionStatus: SubscriptionStatus.ACTIVE
      scheduleRetry: false
      createNextOrder: false
    }
  | {
      type: "user_operation_failed"
      subscriptionStatus: SubscriptionStatus.ACTIVE
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
  const config = getDunningConfig()

  // CASE 1: TERMINAL (revoked/expired) - mark CANCELED
  if (isTerminalSubscriptionError(error)) {
    return {
      type: "terminal",
      subscriptionStatus: SubscriptionStatus.CANCELED,
      scheduleRetry: false,
      createNextOrder: false,
    }
  }

  // CASE 2: UPSTREAM SERVICE ERRORS - let queue handle retry with exponential backoff
  // Don't create next order - queue will retry current order until success or max retries
  if (isUpstreamServiceError(error)) {
    return {
      type: "upstream_error",
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      scheduleRetry: false,
      createNextOrder: false,
    }
  }

  // CASE 2.5: USER OPERATION FAILED - bundler rejected during simulation
  // Keep subscription ACTIVE (another parallel order likely succeeded in batch)
  // Don't create next order - prevents cascade duplication in batch processing
  if (isUserOperationFailedError(error)) {
    return {
      type: "user_operation_failed",
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      scheduleRetry: false,
      createNextOrder: false,
    }
  }

  // CASE 3: RETRYABLE (insufficient balance) - check retry limit
  if (isRetryablePaymentError(error)) {
    if (currentAttempts < config.MAX_ATTEMPTS) {
      const nextRetryAt = calculateNextRetryDate(currentAttempts, failureDate)
      const attemptLabel =
        config.RETRY_INTERVALS[currentAttempts]?.label || "retry"

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

  // CASE 4: OTHER ERRORS - keep subscription ACTIVE, create next order
  return {
    type: "other_error",
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    scheduleRetry: false,
    createNextOrder: true,
  }
}
