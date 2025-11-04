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
const mockRevokeSubscription = mock()

// Mock webhook queue
const mockWebhookQueueSend = mock()

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
        revokeSubscription: mockRevokeSubscription,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
    })
  }

  /**
   * Create service for revoke tests with full deps (needs WebhookService + DO scheduler)
   * Uses createForTesting to mock onchain, then manually sets deps for WebhookService
   */
  function createServiceForRevokeTests(db: D1Database): SubscriptionService {
    const service = SubscriptionService.createForTesting({
      subscriptionRepository: new SubscriptionRepository({
        DB: db,
        LOGGING: "verbose",
      }),
      onchainRepository: {
        validateSubscriptionId: mockValidateSubscriptionId,
        getSubscriptionStatus: mockGetSubscriptionStatus,
        chargeSubscription: mockChargeSubscription,
        revokeSubscription: mockRevokeSubscription,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
    })

    // Manually set deps for WebhookService and DO scheduler (test-only)
    // biome-ignore lint/suspicious/noExplicitAny: Test setup
    ;(service as any).deps = {
      DB: db,
      LOGGING: "verbose",
      WEBHOOK_QUEUE: {
        send: mockWebhookQueueSend,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
      ORDER_SCHEDULER: {
        get: mock(() => ({
          set: mock(),
          delete: mock(),
        })),
        idFromName: mock((id: string) => id),
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
    }

    return service
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
    mockRevokeSubscription.mockResolvedValue({
      transactionHash: "0xrevokehash" as Hash,
    })
    mockWebhookQueueSend.mockResolvedValue(undefined)
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
        provider: Provider.BASE,
      })

      expect(mockValidateSubscriptionId).toHaveBeenCalledWith({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        provider: Provider.BASE,
      })
    })

    it("throws error for invalid subscription ID format", async () => {
      mockValidateSubscriptionId.mockResolvedValue(false)

      await expect(
        service.validateId({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          provider: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.validateId({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          provider: Provider.BASE,
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
        beneficiaryAddress: TEST_OWNER,
        provider: Provider.BASE,
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

    it("creates self-subscription successfully (creator = beneficiary)", async () => {
      const result = await service.createSubscription({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
        beneficiaryAddress: TEST_ACCOUNT, // Self-subscription
        provider: Provider.BASE,
      })

      expect(result).toMatchObject({
        orderId: expect.any(Number),
        orderNumber: 1,
        subscriptionMetadata: {
          amount: "1000000",
          periodInSeconds: 2592000,
        },
      })

      // Verify subscription was created with same creator and beneficiary
      const subscription = await testDB.db
        .prepare(
          "SELECT account_address, beneficiary_address FROM subscriptions WHERE subscription_id = ?",
        )
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ account_address: string; beneficiary_address: string }>()

      expect(subscription?.account_address).toBe(TEST_ACCOUNT)
      expect(subscription?.beneficiary_address).toBe(TEST_ACCOUNT)
    })

    it("throws error if subscription already exists", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      await expect(
        service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
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
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
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
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
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
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
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
        beneficiaryAddress: TEST_OWNER,
        provider: Provider.BASE,
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

      // Verify charge was called with correct params (sends to beneficiary)
      expect(mockChargeSubscription).toHaveBeenCalledWith({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "500000",
        recipient: TEST_OWNER, // Beneficiary receives payment
        provider: Provider.BASE,
      })
    })

    it("skips charge if existing successful transaction found (idempotency)", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
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
        beneficiaryAddress: TEST_OWNER,
        provider: Provider.BASE,
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
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
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
          beneficiaryAddress: TEST_OWNER,
          provider: Provider.BASE,
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
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
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
        provider: Provider.BASE,
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
        provider: Provider.BASE,
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
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
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

  describe("revokeSubscription", () => {
    it("revokes active subscription successfully", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.ACTIVE,
            order: {
              type: OrderType.RECURRING,
              dueAt: "2025-02-01T00:00:00Z",
              amount: "1000000",
              periodInSeconds: 2592000,
              status: OrderStatus.PENDING,
            },
          },
        ],
      })
      dispose = testDB.dispose

      // Register webhook for the account (needed for emitSubscriptionCanceled)
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_address, url, secret) VALUES (?, ?, ?)",
        )
        .bind(TEST_ACCOUNT, "https://example.com/webhook", "test-secret")
        .run()

      const service = createServiceForRevokeTests(testDB.db)

      const result = await service.revokeSubscription({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
      })

      expect(result.status).toBe(SubscriptionStatus.CANCELED)

      // Verify onchain revoke was called
      expect(mockRevokeSubscription).toHaveBeenCalledWith({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        provider: Provider.BASE,
      })

      // Verify subscription status was updated
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.CANCELED)

      // Verify pending order was canceled
      const orderStatus = await testDB.db
        .prepare("SELECT status, failure_reason FROM orders WHERE id = ?")
        .bind(testDB.orderIds[0])
        .first<{ status: string; failure_reason: string }>()

      expect(orderStatus?.status).toBe(OrderStatus.FAILED)
      expect(orderStatus?.failure_reason).toBe("Subscription canceled")
    })

    it("returns existing subscription if already canceled (idempotent)", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.CANCELED,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      const result = await service.revokeSubscription({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
      })

      expect(result.status).toBe(SubscriptionStatus.CANCELED)

      // Verify onchain revoke was NOT called (already canceled)
      expect(mockRevokeSubscription).not.toHaveBeenCalled()
    })

    it("throws 404 if subscription not found", async () => {
      await expect(
        service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).status).toBe(404)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_REQUEST)
        expect((error as HTTPError).message).toBe("Subscription not found")
      }
    })

    it("throws 403 if accountAddress does not match", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.ACTIVE,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      const DIFFERENT_ACCOUNT = "0xdifferent" as Address

      await expect(
        service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: DIFFERENT_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: DIFFERENT_ACCOUNT,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).status).toBe(403)
        expect((error as HTTPError).code).toBe(ErrorCode.FORBIDDEN)
      }
    })

    it("throws 400 if subscription status is not revocable (processing)", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.PROCESSING,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      await expect(
        service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).status).toBe(400)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_REQUEST)
        expect((error as HTTPError).message).toContain("cannot be revoked")
      }
    })

    it("throws 400 if subscription status is not revocable (incomplete)", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.INCOMPLETE,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

      await expect(
        service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).status).toBe(400)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_REQUEST)
      }
    })

    it("throws 404 if permission not found onchain", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.ACTIVE,
          },
        ],
      })
      dispose = testDB.dispose

      const service = createSubscriptionServiceForTest(testDB.db)

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
        service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.revokeSubscription({
          subscriptionId: TEST_SUBSCRIPTION_ID,
          accountAddress: TEST_ACCOUNT,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).status).toBe(404)
        expect((error as HTTPError).code).toBe(ErrorCode.PERMISSION_NOT_FOUND)
      }
    })

    it("skips onchain revoke if already revoked onchain (isSubscribed = false)", async () => {
      const testDB = await createTestDB({
        accounts: [TEST_ACCOUNT],
        subscriptions: [
          {
            subscriptionId: TEST_SUBSCRIPTION_ID,
            accountAddress: TEST_ACCOUNT,
            beneficiaryAddress: TEST_OWNER,
            provider: Provider.BASE,
            status: SubscriptionStatus.ACTIVE,
          },
        ],
      })
      dispose = testDB.dispose

      // Register webhook for the account (needed for emitSubscriptionCanceled)
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_address, url, secret) VALUES (?, ?, ?)",
        )
        .bind(TEST_ACCOUNT, "https://example.com/webhook", "test-secret")
        .run()

      const service = createServiceForRevokeTests(testDB.db)

      // Permission exists but subscription is already revoked onchain
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

      const result = await service.revokeSubscription({
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountAddress: TEST_ACCOUNT,
      })

      expect(result.status).toBe(SubscriptionStatus.CANCELED)

      // Verify onchain revoke was NOT called (already revoked)
      expect(mockRevokeSubscription).not.toHaveBeenCalled()

      // Verify subscription was still canceled in DB
      const subStatus = await testDB.db
        .prepare("SELECT status FROM subscriptions WHERE subscription_id = ?")
        .bind(TEST_SUBSCRIPTION_ID)
        .first<{ status: string }>()

      expect(subStatus?.status).toBe(SubscriptionStatus.CANCELED)
    })
  })
})
