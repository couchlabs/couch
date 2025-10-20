import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { Provider } from "@/providers/provider.interface"

/**
 * Tests for OrderScheduler Durable Object
 *
 * Note: These tests use mocked storage/alarm APIs since DOs require
 * a runtime environment. Full integration tests should be done via
 * wrangler or miniflare.
 */

// Mock the cloudflare:workers module for testing
mock.module("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: DurableObjectState
    // biome-ignore lint/suspicious/noExplicitAny: Test mock
    env: any
    // biome-ignore lint/suspicious/noExplicitAny: Test mock
    constructor(ctx: DurableObjectState, env: any) {
      this.ctx = ctx
      this.env = env
    }
  },
}))

// Import after mocking
const { OrderScheduler } = await import("@/schedulers/order.scheduler")

describe("OrderScheduler", () => {
  let mockState: DurableObjectState
  // biome-ignore lint/suspicious/noExplicitAny: Minimal test mock - only ORDER_QUEUE is used by DO
  let mockEnv: any
  let mockStorage: Map<string, unknown>
  let mockAlarmTime: number | null
  let scheduler: InstanceType<typeof OrderScheduler>

  const TEST_ORDER_ID = 123
  const TEST_PROVIDER_ID = Provider.BASE
  const TEST_DUE_DATE = new Date("2025-02-01T00:00:00Z")

  beforeEach(() => {
    // Create in-memory storage mock
    mockStorage = new Map()
    mockAlarmTime = null

    // Mock environment with ORDER_QUEUE
    mockEnv = {
      ORDER_QUEUE: {
        send: mock(() => Promise.resolve()),
      },
    }

    // Mock DurableObjectState
    mockState = {
      storage: {
        get: mock((key: string) => Promise.resolve(mockStorage.get(key))),
        // biome-ignore lint/suspicious/noExplicitAny: Test mock accepts any value type
        put: mock((key: string, value: any) =>
          Promise.resolve(mockStorage.set(key, value)),
        ),
        delete: mock((key: string) => Promise.resolve(mockStorage.delete(key))),
        deleteAll: mock(() => Promise.resolve(mockStorage.clear())),
        deleteAlarm: mock(() => {
          mockAlarmTime = null
          return Promise.resolve()
        }),
        setAlarm: mock((time: number) => {
          mockAlarmTime = time
          return Promise.resolve()
        }),
        getAlarm: mock(() => Promise.resolve(mockAlarmTime)),
        // biome-ignore lint/suspicious/noExplicitAny: Test mock transaction function
        transaction: mock(async (fn: (txn: any) => Promise<void>) => {
          // Simple transaction mock - just execute the function with storage API
          await fn(mockState.storage)
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: Test mock function parameter
      blockConcurrencyWhile: mock(async (fn: any) => {
        await fn()
      }),
      // biome-ignore lint/suspicious/noExplicitAny: Test mock for DurableObjectState
    } as any

    scheduler = new OrderScheduler(mockState, mockEnv)
  })

  afterEach(() => {
    mock.clearAllMocks()
  })

  describe("set()", () => {
    it("stores order metadata and sets alarm", async () => {
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })

      expect(mockStorage.get("order_id")).toBe(TEST_ORDER_ID)
      expect(mockStorage.get("provider")).toBe(TEST_PROVIDER_ID)
      expect(mockStorage.get("scheduled_for")).toBe(TEST_DUE_DATE.toISOString())
      expect(mockStorage.get("alarm_processed")).toBe(false)
      expect(mockAlarmTime).toBe(TEST_DUE_DATE.getTime())
    })

    it("resets idempotency flag when updating existing schedule", async () => {
      // Set initial schedule
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })

      // Mark as processed
      mockStorage.set("alarm_processed", true)

      // Update schedule
      const newDate = new Date("2025-03-01T00:00:00Z")
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: newDate,
        provider: TEST_PROVIDER_ID,
      })

      // Should reset flag
      expect(mockStorage.get("alarm_processed")).toBe(false)
    })
  })

  describe("update()", () => {
    beforeEach(async () => {
      // Set up initial schedule
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })
    })

    it("updates due date and resets alarm", async () => {
      const newDate = new Date("2025-03-01T00:00:00Z")
      await scheduler.update({ dueAt: newDate })

      expect(mockStorage.get("scheduled_for")).toBe(newDate.toISOString())
      expect(mockAlarmTime).toBe(newDate.getTime())
    })

    it("updates provider", async () => {
      await scheduler.update({ provider: Provider.BASE })

      expect(mockStorage.get("provider")).toBe(Provider.BASE)
    })

    it("resets processing state when updating", async () => {
      // Mark as processed
      mockStorage.set("alarm_processed", true)

      await scheduler.update({ dueAt: new Date("2025-03-01T00:00:00Z") })

      // Should reset flag
      expect(mockStorage.get("alarm_processed")).toBe(false)
    })
  })

  describe("delete()", () => {
    it("deletes alarm and all storage", async () => {
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })

      await scheduler.delete()

      expect(mockAlarmTime).toBe(null)
      expect(mockStorage.size).toBe(0)
    })
  })

  describe("get()", () => {
    it("returns schedule status", async () => {
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })

      const status = await scheduler.get()

      expect(status).toMatchObject({
        orderId: TEST_ORDER_ID,
        provider: TEST_PROVIDER_ID,
        scheduledFor: TEST_DUE_DATE,
        processed: false,
        failed: false,
      })
    })

    it("returns undefined values when no schedule exists", async () => {
      const status = await scheduler.get()

      expect(status).toMatchObject({
        orderId: undefined,
        provider: undefined,
        scheduledAt: undefined,
        scheduledFor: undefined,
        processed: false,
        failed: false,
      })
    })
  })

  describe("alarm()", () => {
    beforeEach(async () => {
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })
    })

    it("sends order to queue and cleans up storage", async () => {
      await scheduler.alarm({ isRetry: false, retryCount: 0 })

      // Verify queue was called
      expect(mockEnv.ORDER_QUEUE.send).toHaveBeenCalledWith({
        orderId: TEST_ORDER_ID,
        provider: TEST_PROVIDER_ID,
      })

      // Verify storage was cleaned up (including alarm_processed flag)
      expect(mockStorage.size).toBe(0)
    })

    it("skips processing if already processed (idempotency)", async () => {
      mockStorage.set("alarm_processed", true)

      await scheduler.alarm({ isRetry: false, retryCount: 0 })

      // Should not send to queue
      expect(mockEnv.ORDER_QUEUE.send).not.toHaveBeenCalled()
    })

    it("throws on failure to trigger Cloudflare retry", async () => {
      mockEnv.ORDER_QUEUE.send.mockRejectedValue(
        new Error("Queue temporarily unavailable"),
      )

      await expect(
        scheduler.alarm({ isRetry: false, retryCount: 0 }),
      ).rejects.toThrow("Queue temporarily unavailable")
    })

    it("stops retrying after max attempts", async () => {
      mockEnv.ORDER_QUEUE.send.mockRejectedValue(new Error("Queue error"))

      // Should not throw - returns early at retry count 3
      await scheduler.alarm({ isRetry: true, retryCount: 3 })

      // Should mark as failed
      expect(mockStorage.get("failed")).toBe(true)
      expect(mockStorage.get("alarm_processed")).toBe(true)

      // Should not send to queue
      expect(mockEnv.ORDER_QUEUE.send).not.toHaveBeenCalled()
    })

    it("returns early if order data missing", async () => {
      mockStorage.clear()

      await scheduler.alarm({ isRetry: false, retryCount: 0 })

      expect(mockEnv.ORDER_QUEUE.send).not.toHaveBeenCalled()
    })
  })

  describe("idempotency guarantees", () => {
    it("prevents double-charging even if cleanup fails", async () => {
      await scheduler.set({
        orderId: TEST_ORDER_ID,
        dueAt: TEST_DUE_DATE,
        provider: TEST_PROVIDER_ID,
      })

      // First alarm fire - succeeds but cleanup fails
      mockState.storage.deleteAll = mock(() =>
        Promise.reject(new Error("Storage error")),
      )

      await expect(
        scheduler.alarm({ isRetry: false, retryCount: 0 }),
      ).rejects.toThrow("Storage error")

      // Verify flag was set BEFORE cleanup
      expect(mockStorage.get("alarm_processed")).toBe(true)
      expect(mockEnv.ORDER_QUEUE.send).toHaveBeenCalledTimes(1)

      // Second alarm fire (Cloudflare retries) - should skip
      await scheduler.alarm({ isRetry: true, retryCount: 1 })

      // Should not send again due to flag
      expect(mockEnv.ORDER_QUEUE.send).toHaveBeenCalledTimes(1)
    })
  })
})
