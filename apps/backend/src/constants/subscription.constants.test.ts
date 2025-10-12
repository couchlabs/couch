import { describe, expect, it } from "bun:test"
import { addDays, FIXED_DATE } from "@tests/test-utils"
import {
  calculateNextRetryDate,
  getDunningConfig,
} from "./subscription.constants"

describe("calculateNextRetryDate", () => {
  describe("Retry date calculation", () => {
    it("calculates first retry date (attempt 0 -> Day 2)", () => {
      const result = calculateNextRetryDate(0, FIXED_DATE)
      const expected = addDays(FIXED_DATE, 2)
      expect(result).toEqual(expected)
    })

    it("calculates second retry date (attempt 1 -> Day 7 cumulative)", () => {
      const result = calculateNextRetryDate(1, FIXED_DATE)
      const expected = addDays(FIXED_DATE, 7) // 2 + 5 = 7 days
      expect(result).toEqual(expected)
    })

    it("calculates third retry date (attempt 2 -> Day 14 cumulative)", () => {
      const result = calculateNextRetryDate(2, FIXED_DATE)
      const expected = addDays(FIXED_DATE, 14) // 2 + 5 + 7 = 14 days
      expect(result).toEqual(expected)
    })

    it("calculates fourth retry date (attempt 3 -> Day 21 cumulative)", () => {
      const result = calculateNextRetryDate(3, FIXED_DATE)
      const expected = addDays(FIXED_DATE, 21) // 2 + 5 + 7 + 7 = 21 days
      expect(result).toEqual(expected)
    })

    it("throws error when attempt = MAX_ATTEMPTS", () => {
      const DUNNING_CONFIG = getDunningConfig()
      expect(() =>
        calculateNextRetryDate(DUNNING_CONFIG.MAX_ATTEMPTS, FIXED_DATE),
      ).toThrow("Max retry attempts exceeded")
    })

    it("throws error when attempt > MAX_ATTEMPTS", () => {
      const DUNNING_CONFIG = getDunningConfig()
      expect(() =>
        calculateNextRetryDate(DUNNING_CONFIG.MAX_ATTEMPTS + 1, FIXED_DATE),
      ).toThrow("Max retry attempts exceeded")
    })
  })

  describe("Edge cases", () => {
    it("handles dates at month boundaries", () => {
      const endOfMonth = new Date("2025-01-30T00:00:00Z")
      const result = calculateNextRetryDate(0, endOfMonth)
      const expected = new Date("2025-02-01T00:00:00Z") // Jan 30 + 2 days = Feb 1
      expect(result).toEqual(expected)
    })

    it("handles leap year dates", () => {
      const leapYearDate = new Date("2024-02-27T00:00:00Z")
      const result = calculateNextRetryDate(0, leapYearDate)
      const expected = new Date("2024-02-29T00:00:00Z") // Feb 27 + 2 days = Feb 29 (leap year)
      expect(result).toEqual(expected)
    })

    it("preserves time of day from failure date", () => {
      const dateWithTime = new Date("2025-01-15T14:30:45.123Z")
      const result = calculateNextRetryDate(0, dateWithTime)
      const expected = new Date("2025-01-17T14:30:45.123Z")
      expect(result).toEqual(expected)
    })
  })
})
