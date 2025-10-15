import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
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
import { SubscriptionService } from "./subscription.service"

// Mock only the onchain repository (blockchain calls)
const mockValidateSubscriptionId = mock()
const mockGetSubscriptionStatus = mock()
const mockChargeSubscription = mock()

describe("SubscriptionService", () => {
  let dispose: (() => Promise<void>) | undefined
  let testDB: {
    db: D1Database
    orderIds: number[]
    dispose: () => Promise<void>
  }
  let service: SubscriptionService

  const TEST_ACCOUNT = "0xabcd" as Address
  const TEST_OWNER = "0x5678" as Address
  const TEST_SUBSCRIPTION_ID = "0x1234" as Hash

  const MOCK_CHARGE_RESULT: ChargeResult = {
    transactionHash: "0xtxhash" as Hash,
  }

  const MOCK_SUBSCRIPTION_STATUS: SubscriptionStatusResult = {
    subscription: {
      permissionExists: true,
      isSubscribed: true,
      subscriptionOwner: TEST_OWNER,
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
   * Helper to create SubscriptionService with test dependencies
   * Sets up real database + repository, mocked blockchain calls
   */
  function createSubscriptionServiceForTest(
    db: D1Database,
  ): SubscriptionService {
    return SubscriptionService.createForTesting({
      subscriptionRepository: new SubscriptionRepository({
        DB: db,
        LOGGING: "verbose",
      }),
      onchainRepository: {
        validateSubscriptionId: mockValidateSubscriptionId,
        getSubscriptionStatus: mockGetSubscriptionStatus,
        chargeSubscription: mockChargeSubscription,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
    })
  }

  beforeEach(async () => {
    // Create test database with base account
    testDB = await createTestDB({
      accounts: [TEST_ACCOUNT],
    })
    dispose = testDB.dispose

    // Create service instance
    service = createSubscriptionServiceForTest(testDB.db)

    // Set default happy-path mock behaviors
    mockValidateSubscriptionId.mockResolvedValue(true)
    mockGetSubscriptionStatus.mockResolvedValue(MOCK_SUBSCRIPTION_STATUS)
    mockChargeSubscription.mockResolvedValue(MOCK_CHARGE_RESULT)
  })

  afterEach(async () => {
    // Clean up database
    if (dispose) {
      await dispose()
    }
    // Reset all mocks
    mock.clearAllMocks()
  })

  describe("validateId", () => {
    it("validates subscription ID successfully", async () => {
      await service.validateId({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        providerId: Provider.BASE,
      })

      expect(mockValidateSubscriptionId).toHaveBeenCalledWith({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        providerId: Provider.BASE,
      })
    })

    it("throws error for invalid subscription ID format", async () => {
      mockValidateSubscriptionId.mockResolvedValue(false)

      await expect(
        service.validateId({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          providerId: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.validateId({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          providerId: Provider.BASE,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
      }
    })
  })

  describe("createSubscription", () => {
    it("creates subscription successfully with valid onchain state", async () => {
      const result = await service.createSubscription({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
        providerId: Provider.BASE,
      })

      expect(result).toMatchObject({
        orderId: expect.any(Number),
        orderNumber: 1,
        subscriptionMetadata: {
          amount: "1000000",
          periodInSeconds: 2592000,
        },
      })

      // Verify subscription was created in database
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.PROCESSING)
    })

    it("throws error if subscription already exists", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            ownerAddress: TEST_OWNER,
            accountAddress: TEST_ACCOUNT,
            providerId: Provider.BASE,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      await expect(
        service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.SUBSCRIPTION_EXISTS)
        expect((error as HTTPError).status).toBe(409)
      }
    })

    it("throws error if subscription not active onchain", async () => {
      // Explicitly construct discriminated union with permissionExists: true, isSubscribed: false
      mockGetSubscriptionStatus.mockResolvedValue({
        subscription: {
          permissionExists: true,
          isSubscribed: false,
          subscriptionOwner:
            MOCK_SUBSCRIPTION_STATUS.subscription.subscriptionOwner,
          remainingChargeInPeriod:
            MOCK_SUBSCRIPTION_STATUS.subscription.remainingChargeInPeriod,
          currentPeriodStart:
            MOCK_SUBSCRIPTION_STATUS.subscription.currentPeriodStart,
          nextPeriodStart:
            MOCK_SUBSCRIPTION_STATUS.subscription.nextPeriodStart,
          recurringCharge:
            MOCK_SUBSCRIPTION_STATUS.subscription.recurringCharge,
          periodInSeconds:
            MOCK_SUBSCRIPTION_STATUS.subscription.periodInSeconds,
        },
        context: MOCK_SUBSCRIPTION_STATUS.context,
      })

      await expect(
        service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.FORBIDDEN)
      }
    })

    it("throws error if permission not found onchain", async () => {
      mockGetSubscriptionStatus.mockResolvedValue({
        subscription: {
          permissionExists: false,
          isSubscribed: false,
          recurringCharge: "0",
        },
        context: {
          spenderAddress: "0xspender" as Address,
        },
      })

      await expect(
        service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.PERMISSION_NOT_FOUND)
        expect((error as HTTPError).status).toBe(404)
      }
    })
  })

  describe("processActivationCharge", () => {
    it("processes activation charge successfully", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            ownerAddress: TEST_OWNER,
            accountAddress: TEST_ACCOUNT,
            providerId: Provider.BASE,
            status: SubscriptionStatus.PROCESSING,
            order: {
              type: OrderType.INITIAL,
              dueAt: "2025-01-01T00:00:00Z",
              amount: "500000",
              periodInSeconds: 2592000,
              status: OrderStatus.PROCESSING,
            },
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      const result = await service.processActivationCharge({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
        providerId: Provider.BASE,
        orderId: testDB.orderIds[0],
        orderNumber: 1,
      })

      expect(result).toMatchObject({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
        transaction: {
          hash: MOCK_CHARGE_RESULT.transactionHash,
          amount: "500000",
        },
        order: {
          id: testDB.orderIds[0],
          number: 1,
          dueAt: "2025-01-01T00:00:00.000Z",
          periodInSeconds: 2592000,
        },
        nextOrder: {
          date: "2025-02-01T00:00:00.000Z",
          amount: "1000000",
          periodInSeconds: 2592000,
        },
      })

      // Verify charge was called with correct params
      expect(mockChargeSubscription).toHaveBeenCalledWith({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "500000",
        recipient: TEST_ACCOUNT,
        providerId: Provider.BASE,
      })
    })

    it("skips charge if existing successful transaction found (idempotency)", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            ownerAddress: TEST_OWNER,
            accountAddress: TEST_ACCOUNT,
            providerId: Provider.BASE,
            status: SubscriptionStatus.PROCESSING,
            order: {
              type: OrderType.INITIAL,
              dueAt: "2025-01-01T00:00:00Z",
              amount: "500000",
              periodInSeconds: 2592000,
              status: OrderStatus.PROCESSING,
            },
          },
        ],
      })
      dispose = testDB.dispose

      // Create existing successful transaction
      await testDB.db
        .prepare(
          "INSERT INTO transactions (transaction_hash, order_id, subscription_id, amount, status) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          "0xexisting",
          testDB.orderIds[0],
          TEST_SUBSCRIPTION_ID,
          "500000",
          "confirmed",
        )
        .run()

      const service = createSubscriptionServiceForTest(testDB.db)

      const result = await service.processActivationCharge({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
        providerId: Provider.BASE,
        orderId: testDB.orderIds[0],
        orderNumber: 1,
      })

      expect(result.transaction.hash).toBe("0xexisting" as Hash)

      // Verify chargeSubscription was NOT called (idempotency)
      expect(mockChargeSubscription).not.toHaveBeenCalled()
    })

    it("throws error if missing nextPeriodStart", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            ownerAddress: TEST_OWNER,
            accountAddress: TEST_ACCOUNT,
            providerId: Provider.BASE,
            status: SubscriptionStatus.PROCESSING,
            order: {
              type: OrderType.INITIAL,
              dueAt: "2025-01-01T00:00:00Z",
              amount: "500000",
              periodInSeconds: 2592000,
              status: OrderStatus.PROCESSING,
            },
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      // Test missing nextPeriodStart - properly construct discriminated union
      mockGetSubscriptionStatus.mockResolvedValue({
        subscription: {
          permissionExists: true,
          isSubscribed: true,
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
      })

      await expect(
        service.processActivationCharge({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          providerId: Provider.BASE,
          orderId: testDB.orderIds[0],
          orderNumber: 1,
        }),
      ).rejects.toThrow("missing nextPeriodStart")
    })
  })

  describe("completeActivation", () => {
    it("completes activation successfully in background", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            ownerAddress: TEST_OWNER,
            accountAddress: TEST_ACCOUNT,
            providerId: Provider.BASE,
            status: SubscriptionStatus.PROCESSING,
            order: {
              type: OrderType.INITIAL,
              dueAt: "2025-01-01T00:00:00Z",
              amount: "500000",
              periodInSeconds: 2592000,
              status: OrderStatus.PROCESSING,
            },
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      const activationResult = {
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
        providerId: Provider.BASE,
        transaction: {
          hash: "0xtxhash" as Hash,
          amount: "500000",
        },
        order: {
          id: testDB.orderIds[0],
          number: 1,
          dueAt: "2025-01-01T00:00:00Z",
          periodInSeconds: 2592000,
        },
        nextOrder: {
          date: "2025-02-01T00:00:00Z",
          amount: "1000000",
          periodInSeconds: 2592000,
        },
      }

      await service.completeActivation(activationResult)

      // Verify subscription status was updated to ACTIVE
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.ACTIVE)

      // Verify transaction was recorded
      const txRecord = await testDB.db
        .prepare("SELECT * FROM transactions WHERE transaction_hash = ?")
        .bind("0xtxhash")
        .first()

      expect(txRecord).toBeDefined()

      // Verify order was marked as PAID
      const orderStatus = await testDB.db
        .prepare("SELECT status FROM orders WHERE id = ?")
        .bind(testDB.orderIds[0])
        .first<{ status: string }>()

      expect(orderStatus?.status).toBe(OrderStatus.PAID)

      // Verify next order was created
      const nextOrderCount = await testDB.db
        .prepare(
          "SELECT COUNT(*) as count FROM orders WHERE subscription_id = ? AND type = ?",
        )
        .bind(TEST_SUBSCRIPTION_ID, OrderType.RECURRING)
        .first<{ count: number }>()

      expect(nextOrderCount?.count).toBe(1)
    })

    it("does not throw error if activation fails (background processing)", async () => {
      const activationResult = {
        subscriptionId: "0xinvalid" as Hash, // Non-existent subscription
        accountAddress: TEST_ACCOUNT,
        providerId: Provider.BASE,
        transaction: {
          hash: "0xtxhash" as Hash,
          amount: "500000",
        },
        order: {
          id: 9999, // Non-existent order
          number: 1,
          dueAt: "2025-01-01T00:00:00Z",
          periodInSeconds: 2592000,
        },
        nextOrder: {
          date: "2025-02-01T00:00:00Z",
          amount: "1000000",
          periodInSeconds: 2592000,
        },
      }

      // Should not throw (background processing logs errors)
      await expect(
        service.completeActivation(activationResult),
      ).resolves.toBeUndefined()
    })
  })

  describe("markSubscriptionIncomplete", () => {
    it("marks subscription as incomplete", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            ownerAddress: TEST_OWNER,
            accountAddress: TEST_ACCOUNT,
            providerId: Provider.BASE,
            status: SubscriptionStatus.PROCESSING,
            order: {
              type: OrderType.INITIAL,
              dueAt: "2025-01-01T00:00:00Z",
              amount: "500000",
              periodInSeconds: 2592000,
              status: OrderStatus.PROCESSING,
            },
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      await service.markSubscriptionIncomplete({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        orderId: testDB.orderIds[0],
        reason: "INSUFFICIENT_BALANCE",
      })

      // Verify subscription status was updated to INCOMPLETE
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.INCOMPLETE)

      // Verify order was marked as FAILED
      const orderStatus = await testDB.db
        .prepare("SELECT status, failure_reason FROM orders WHERE id = ?")
        .bind(testDB.orderIds[0])
        .first<{ status: string; failure_reason: string }>()

      expect(orderStatus?.status).toBe(OrderStatus.FAILED)
      expect(orderStatus?.failure_reason).toBe("INSUFFICIENT_BALANCE")
    })
  })
})
