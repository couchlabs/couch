/**
 * Retry logic for upstream service errors
 *
 * Handles transient infrastructure failures from external services (CDP, Base SDK, AWS, etc)
 * Uses exponential backoff with capping to balance fast recovery with avoiding thundering herd
 *
 * This is separate from dunning.logic.ts which handles user payment errors (INSUFFICIENT_BALANCE)
 */

/**
 * Configuration for exponential backoff delay calculation.
 * Note: Max retry limit is configured at queue level in alchemy.run.ts (maxRetries: 10)
 */
export const UPSTREAM_RETRY_CONFIG = {
  /**
   * Base delay in seconds for first retry
   * Fast initial retry for quick recovery from brief outages
   */
  baseDelaySeconds: 5,

  /**
   * Maximum delay cap in seconds (10 minutes)
   * Prevents excessively long delays while still giving time for recovery
   */
  maxDelaySeconds: 600,

  /**
   * Backoff multiplier for exponential growth
   * 2^n growth: 5s, 10s, 20s, 40s, 80s, 160s, 320s, then capped at 600s
   */
  backoffMultiplier: 2,
} as const

/**
 * Calculate retry delay using capped exponential backoff
 *
 * Formula: min(baseDelay * (multiplier^attempts), maxDelay)
 *
 * Example timeline with default config:
 * - Attempt 0 (initial): immediate
 * - Retry 1: 5s
 * - Retry 2: 10s
 * - Retry 3: 20s
 * - Retry 4: 40s
 * - Retry 5: 80s
 * - Retry 6: 160s
 * - Retry 7: 320s
 * - Retry 8: 600s (capped)
 * - Retry 9: 600s (capped)
 * - Retry 10: 600s (capped)
 * Total: ~40 minutes
 *
 * @param attempts - Current number of delivery attempts (from message.attempts)
 * @returns Delay in seconds before next retry
 */
export function calculateUpstreamRetryDelay(attempts: number): number {
  const { baseDelaySeconds, backoffMultiplier, maxDelaySeconds } =
    UPSTREAM_RETRY_CONFIG

  // Calculate exponential delay: base * (2^attempts)
  const exponentialDelay = baseDelaySeconds * backoffMultiplier ** attempts

  // Cap at maximum to prevent excessive delays
  return Math.min(exponentialDelay, maxDelaySeconds)
}
