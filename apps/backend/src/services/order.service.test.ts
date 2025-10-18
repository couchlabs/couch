import { afterEach, describe, expect, it, mock } from "bun:test"
import type { D1Database } from "@cloudflare/workers-types"
import { createTestDB } from "@tests/test-db"
import type { Address, Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { Provider } from "@/providers/provider.interface"
import type {
  ChargeResult,
  SubscriptionStatusResult,
} from "@/repositories/onchain.repository"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { OrderService } from "./order.service"

// Mock only the onchain repository (blockchain calls)
const mockChargeSubscription = mock()
const mockGetSubscriptionStatus = mock()

// Mock ORDER_SCHEDULER DO
const mockSchedulerSet = mock(() => Promise.resolve())
const mockSchedulerUpdate = mock(() => Promise.resolve())
const mockSchedulerDelete = mock(() => Promise.resolve())
const mockSchedulerStub = {
  set: mockSchedulerSet,
  update: mockSchedulerUpdate,
  delete: mockSchedulerDelete,
}
const mockOrderScheduler = {
  get: mock(() => mockSchedulerStub),
  idFromName: mock((name: string) => ({ toString: () => name })),
}

describe("OrderService", () => {
  let dispose: (() => Promise<void>) | undefined
  const TEST_ACCOUNT = "0xabcd" as Address
  const TEST_SUBSCRIPTION_ID = "0x1234" as Hash
  const TEST_OWNER = "0x5678" as Address

  const MOCK_CHARGE_RESULT: ChargeResult = {
    transactionHash: "0xtxhash" as Hash,
  }

  const MOCK_SUBSCRIPTION_STATUS: SubscriptionStatusResult = {
    subscription: {
      permissionExists: true,
      isSubscribed: true,
      subscriptionOwner: "0xowner" as Address,
      remainingChargeInPeriod: "500000",
      currentPeriodStart: new Date("2025-01-01T00:00:00Z"),
      nextPeriodStart: new Date("2025-02-01T00:00:00Z"),
      recurringCharge: "1000000",
      periodInSeconds: 2592000,
    },
    context: {
      spenderAddress: "0xspender" as Address,
    },
  }

  /**
   * Helper to create test database with default subscription setup
   * Allows overriding specific fields for test variations
   */
  async function createTestDBWithOrder(overrides?: {
    subscriptionStatus?: SubscriptionStatus
    orderStatus?: OrderStatus
    orderAttempts?: number
  }) {
    const testDB = await createTestDB({
      accounts: [TEST_ACCOUNT],
      subscriptions: [
        {
          subscriptionId: TEST_SUBSCRIPTION_ID,
          creatorAddress: TEST_ACCOUNT,
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
          status: overrides?.subscriptionStatus,
          order: {
            type: OrderType.INITIAL,
            dueAt: "2025-01-01T00:00:00Z",
            amount: "1000000",
            periodInSeconds: 2592000,
            status: overrides?.orderStatus ?? OrderStatus.PROCESSING,
            attempts: overrides?.orderAttempts,
          },
        },
      ],
    })
    dispose = testDB.dispose
    return testDB
  }

  /**
   * Helper to create OrderService with test dependencies
   * Sets up real database + repository, mocked blockchain calls
   */
  function createOrderServiceForTest(db: D1Database): OrderService {
    return OrderService.createForTesting({
      subscriptionRepository: new SubscriptionRepository({
        DB: db,
        LOGGING: "verbose",
      }),
      onchainRepository: {
        chargeSubscription: mockChargeSubscription,
        getSubscriptionStatus: mockGetSubscriptionStatus,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
      env: {
        DB: db,
        LOGGING: "verbose",
        ORDER_SCHEDULER: mockOrderScheduler,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
    })
  }

  afterEach(async () => {
    // Clean up database
    if (dispose) {
      await dispose()
    }
    // Set default happy-path mock behaviors
    mockChargeSubscription.mockResolvedValue(MOCK_CHARGE_RESULT)
    mockGetSubscriptionStatus.mockResolvedValue(MOCK_SUBSCRIPTION_STATUS)
    // Reset all mocks
    mock.clearAllMocks()
  })

  describe("getOrderDetails", () => {
    it("returns order details when order exists", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)
      const orderId = testDB.orderIds[0]
      const orderDetails = await orderService.getOrderDetails(orderId)

      expect(orderDetails).toMatchObject({
        id: orderId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        creatorAddress: TEST_ACCOUNT,
        amount: "1000000",
        orderNumber: 1,
        status: OrderStatus.PROCESSING,
      })
    })

    it("throws error when order not found", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
      })
      dispose = testDB.dispose

      const orderService = createOrderServiceForTest(testDB.db)

      await expect(orderService.getOrderDetails(999)).rejects.toThrow(
        "Order 999 not found",
      )
    })
  })

  describe("processOrder - Success Scenarios", () => {
    it("processes successful payment and creates next order", async () => {
      const testDB = await createTestDBWithOrder({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
      const orderService = createOrderServiceForTest(testDB.db)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result).toEqual({
        success: true,
        transactionHash: MOCK_CHARGE_RESULT.transactionHash,
        orderNumber: 1,
        nextOrderCreated: true,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })

      // Verify blockchain charge was called with correct params (sends to beneficiary)
      expect(mockChargeSubscription).toHaveBeenCalledWith({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "1000000",
        recipient: TEST_OWNER, // Beneficiary receives payment
        provider: Provider.BASE,
      })

      // Verify order status via public getOrderDetails method
      const updatedOrder = await orderService.getOrderDetails(
        testDB.orderIds[0],
      )
      expect(updatedOrder.status).toBe(OrderStatus.PAID)
    })

    it("processes successful payment without creating next order when subscription cancelled", async () => {
      const testDB = await createTestDBWithOrder({
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
      const orderService = createOrderServiceForTest(testDB.db)

      const cancelledStatus: SubscriptionStatusResult = {
        subscription: {
          permissionExists: true,
          isSubscribed: false,
          subscriptionOwner:
            MOCK_SUBSCRIPTION_STATUS.subscription.subscriptionOwner,
          remainingChargeInPeriod:
            MOCK_SUBSCRIPTION_STATUS.subscription.remainingChargeInPeriod,
          currentPeriodStart:
            MOCK_SUBSCRIPTION_STATUS.subscription.currentPeriodStart,
          nextPeriodStart: undefined,
          recurringCharge:
            MOCK_SUBSCRIPTION_STATUS.subscription.recurringCharge,
          periodInSeconds:
            MOCK_SUBSCRIPTION_STATUS.subscription.periodInSeconds,
        },
        context: MOCK_SUBSCRIPTION_STATUS.context,
      }

      mockGetSubscriptionStatus.mockResolvedValue(cancelledStatus)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result).toEqual({
        success: true,
        transactionHash: MOCK_CHARGE_RESULT.transactionHash,
        orderNumber: 1,
        nextOrderCreated: false,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
      })
    })

    it("reactivates subscription when processing successful retry", async () => {
      const testDB = await createTestDBWithOrder({
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        orderStatus: OrderStatus.FAILED,
        orderAttempts: 1,
      })
      const orderService = createOrderServiceForTest(testDB.db)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(true)
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE)

      // Verify subscription was actually reactivated in database
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.ACTIVE)
    })

    it("throws error when order not found", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
      })
      dispose = testDB.dispose

      const orderService = createOrderServiceForTest(testDB.db)

      await expect(
        orderService.processOrder({
          orderId: 999,
          provider: Provider.BASE,
        }),
      ).rejects.toThrow("Order 999 not found")
    })
  })

  describe("processOrder - Failure Scenarios: Terminal Errors", () => {
    it("handles terminal error (PERMISSION_EXPIRED) by marking subscription canceled", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const terminalError = new HTTPError(
        403,
        ErrorCode.PERMISSION_EXPIRED,
        "Permission expired",
      )

      mockChargeSubscription.mockRejectedValue(terminalError)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result).toMatchObject({
        success: false,
        failureReason: ErrorCode.PERMISSION_EXPIRED,
        failureMessage: "Permission expired",
        nextOrderCreated: false,
        subscriptionStatus: SubscriptionStatus.CANCELED,
      })

      // Verify order was marked as failed via public method
      const updatedOrder = await orderService.getOrderDetails(
        testDB.orderIds[0],
      )
      expect(updatedOrder.status).toBe(OrderStatus.FAILED)
    })

    it("handles terminal error (PERMISSION_REVOKED) by marking subscription canceled", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const terminalError = new HTTPError(
        403,
        ErrorCode.PERMISSION_REVOKED,
        "Permission revoked",
      )

      mockChargeSubscription.mockRejectedValue(terminalError)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.subscriptionStatus).toBe(SubscriptionStatus.CANCELED)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.PERMISSION_REVOKED)
      }
    })

    it("handles SUBSCRIPTION_NOT_ACTIVE as other error, keeping subscription active", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const notActiveError = new HTTPError(
        400,
        ErrorCode.SUBSCRIPTION_NOT_ACTIVE,
        "Subscription not active",
      )

      mockChargeSubscription.mockRejectedValue(notActiveError)
      mockGetSubscriptionStatus.mockResolvedValue(MOCK_SUBSCRIPTION_STATUS)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.SUBSCRIPTION_NOT_ACTIVE)
      }
      expect(result.nextOrderCreated).toBe(true)
    })
  })

  describe("processOrder - Failure Scenarios: Retryable Errors", () => {
    it("schedules retry on first INSUFFICIENT_BALANCE failure", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const insufficientBalanceError = new HTTPError(
        400,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )

      mockChargeSubscription.mockRejectedValue(insufficientBalanceError)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.INSUFFICIENT_BALANCE)
        expect(result.nextRetryAt).toBeDefined()
      }
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.PAST_DUE)
      expect(result.nextOrderCreated).toBe(false)

      // Verify order was marked as failed with attempts incremented
      const updatedOrder = await orderService.getOrderDetails(
        testDB.orderIds[0],
      )
      expect(updatedOrder.status).toBe(OrderStatus.FAILED)
      expect(updatedOrder.attempts).toBe(1)
    })

    it("schedules intermediate retry with correct interval (attempt 3)", async () => {
      const testDB = await createTestDBWithOrder({
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        orderStatus: OrderStatus.FAILED,
        orderAttempts: 2, // Third attempt (0-indexed means this is attempt 3)
      })
      const orderService = createOrderServiceForTest(testDB.db)

      const insufficientBalanceError = new HTTPError(
        400,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )

      mockChargeSubscription.mockRejectedValue(insufficientBalanceError)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.INSUFFICIENT_BALANCE)
        expect(result.nextRetryAt).toBeDefined()
      }
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.PAST_DUE)
      expect(result.nextOrderCreated).toBe(false)

      // Verify order was marked as failed with attempts incremented to 3
      const updatedOrder = await orderService.getOrderDetails(
        testDB.orderIds[0],
      )
      expect(updatedOrder.status).toBe(OrderStatus.FAILED)
      expect(updatedOrder.attempts).toBe(3)

      // Verify subscription is still PAST_DUE (not UNPAID yet)
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.PAST_DUE)
    })

    it("marks subscription UNPAID after max retries exhausted", async () => {
      const testDB = await createTestDBWithOrder({
        orderStatus: OrderStatus.FAILED,
        orderAttempts: 5, // Already at max retries
      })
      const orderService = createOrderServiceForTest(testDB.db)

      const insufficientBalanceError = new HTTPError(
        400,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient balance",
      )

      mockChargeSubscription.mockRejectedValue(insufficientBalanceError)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.INSUFFICIENT_BALANCE)
      }
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.UNPAID)
      expect(result.nextOrderCreated).toBe(false)
    })
  })

  describe("processOrder - Failure Scenarios: Other Errors", () => {
    it("keeps subscription active and creates next order on non-retryable error", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const paymentError = new HTTPError(
        500,
        ErrorCode.PAYMENT_FAILED,
        "Payment processing error",
      )

      mockChargeSubscription.mockRejectedValue(paymentError)
      mockGetSubscriptionStatus.mockResolvedValue(MOCK_SUBSCRIPTION_STATUS)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.PAYMENT_FAILED)
      }
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE)
      expect(result.nextOrderCreated).toBe(true)

      // Verify failed order's scheduler was deleted to prevent alarm retries
      expect(mockSchedulerDelete).toHaveBeenCalledTimes(1)
      expect(mockOrderScheduler.idFromName).toHaveBeenCalledWith(
        String(testDB.orderIds[0]),
      )
    })

    it("handles non-HTTPError as PAYMENT_FAILED", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const genericError = new Error("Network timeout")

      mockChargeSubscription.mockRejectedValue(genericError)
      mockGetSubscriptionStatus.mockResolvedValue(MOCK_SUBSCRIPTION_STATUS)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.failureReason).toBe(ErrorCode.PAYMENT_FAILED)
        expect(result.failureMessage).toBe("Network timeout")
      }
      expect(result.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE)
    })

    it("handles other error without creating next order when subscription cancelled", async () => {
      const testDB = await createTestDBWithOrder()
      const orderService = createOrderServiceForTest(testDB.db)

      const paymentError = new HTTPError(
        500,
        ErrorCode.PAYMENT_FAILED,
        "Payment processing error",
      )

      const cancelledStatus: SubscriptionStatusResult = {
        subscription: {
          permissionExists: true,
          isSubscribed: false,
          subscriptionOwner:
            MOCK_SUBSCRIPTION_STATUS.subscription.subscriptionOwner,
          remainingChargeInPeriod:
            MOCK_SUBSCRIPTION_STATUS.subscription.remainingChargeInPeriod,
          currentPeriodStart:
            MOCK_SUBSCRIPTION_STATUS.subscription.currentPeriodStart,
          nextPeriodStart: undefined,
          recurringCharge:
            MOCK_SUBSCRIPTION_STATUS.subscription.recurringCharge,
          periodInSeconds:
            MOCK_SUBSCRIPTION_STATUS.subscription.periodInSeconds,
        },
        context: MOCK_SUBSCRIPTION_STATUS.context,
      }

      mockChargeSubscription.mockRejectedValue(paymentError)
      mockGetSubscriptionStatus.mockResolvedValue(cancelledStatus)

      const result = await orderService.processOrder({
        orderId: testDB.orderIds[0],
        provider: Provider.BASE,
      })

      expect(result.success).toBe(false)
      expect(result.nextOrderCreated).toBe(false)
    })
  })
})
