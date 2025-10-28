import { describe, expect, it } from "bun:test"
import {
  calculateUpstreamRetryDelay,
  UPSTREAM_RETRY_CONFIG,
} from "./retry.logic"

describe("calculateUpstreamRetryDelay", () => {
  describe("Exponential backoff calculation", () => {
    it("returns base delay for first attempt (attempts = 0)", () => {
      const delay = calculateUpstreamRetryDelay(0)
      expect(delay).toBe(5) // base delay
    })

    it("doubles delay for each attempt", () => {
      expect(calculateUpstreamRetryDelay(0)).toBe(5) // 5 * 2^0 = 5
      expect(calculateUpstreamRetryDelay(1)).toBe(10) // 5 * 2^1 = 10
      expect(calculateUpstreamRetryDelay(2)).toBe(20) // 5 * 2^2 = 20
      expect(calculateUpstreamRetryDelay(3)).toBe(40) // 5 * 2^3 = 40
      expect(calculateUpstreamRetryDelay(4)).toBe(80) // 5 * 2^4 = 80
      expect(calculateUpstreamRetryDelay(5)).toBe(160) // 5 * 2^5 = 160
      expect(calculateUpstreamRetryDelay(6)).toBe(320) // 5 * 2^6 = 320
    })

    it("caps delay at maxDelaySeconds (600s = 10 minutes)", () => {
      expect(calculateUpstreamRetryDelay(7)).toBe(600) // Would be 640, capped at 600
      expect(calculateUpstreamRetryDelay(8)).toBe(600) // Would be 1280, capped at 600
      expect(calculateUpstreamRetryDelay(9)).toBe(600) // Would be 2560, capped at 600
      expect(calculateUpstreamRetryDelay(10)).toBe(600) // Would be 5120, capped at 600
    })

    it("handles large attempt numbers", () => {
      // Should still be capped at max delay
      expect(calculateUpstreamRetryDelay(100)).toBe(
        UPSTREAM_RETRY_CONFIG.maxDelaySeconds,
      )
    })

    it("uses correct config values", () => {
      // Verify we're using the exported config
      expect(UPSTREAM_RETRY_CONFIG.baseDelaySeconds).toBe(5)
      expect(UPSTREAM_RETRY_CONFIG.maxDelaySeconds).toBe(600)
      expect(UPSTREAM_RETRY_CONFIG.backoffMultiplier).toBe(2)
    })
  })

  describe("Retry timeline calculation", () => {
    it("calculates total retry window correctly", () => {
      const delays = []
      for (let attempt = 0; attempt <= 10; attempt++) {
        delays.push(calculateUpstreamRetryDelay(attempt))
      }

      // Sum all delays (except first attempt which is immediate)
      const totalDelay = delays.slice(1).reduce((sum, delay) => sum + delay, 0)

      // Total should be approximately 50 minutes
      // Attempt 0: 5s (excluded from sum)
      // Attempts 1-10: 10 + 20 + 40 + 80 + 160 + 320 + 600 + 600 + 600 + 600 = 3030 seconds ≈ 50.5 minutes
      expect(totalDelay).toBe(3030)
      expect(totalDelay).toBeGreaterThanOrEqual(3000) // At least 50 minutes
      expect(totalDelay).toBeLessThanOrEqual(3100) // Less than 52 minutes
    })

    it("provides reasonable initial retry delays for quick recovery", () => {
      // First few retries should be fast (under 1 minute)
      expect(calculateUpstreamRetryDelay(0)).toBeLessThan(60)
      expect(calculateUpstreamRetryDelay(1)).toBeLessThan(60)
      expect(calculateUpstreamRetryDelay(2)).toBeLessThan(60)
      expect(calculateUpstreamRetryDelay(3)).toBeLessThan(60)
    })

    it("provides reasonable later retry delays for persistent issues", () => {
      // Later retries should give time for recovery (capped at 10 minutes)
      expect(calculateUpstreamRetryDelay(7)).toBe(600)
      expect(calculateUpstreamRetryDelay(8)).toBe(600)
      expect(calculateUpstreamRetryDelay(9)).toBe(600)
    })
  })
})
