import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { createTestDB } from "@tests/test-db"
import type { Address, Hash } from "viem"
import {
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { Provider } from "@/providers/provider.interface"
import { WebhookRepository } from "@/repositories/webhook.repository"
import type { ActivationResult } from "@/services/subscription.service"
import { WebhookService } from "./webhook.service"

// Mock only the webhook queue
const mockQueueSend = mock()

describe("WebhookService", () => {
  let testDB: Awaited<ReturnType<typeof createTestDB>>
  let service: WebhookService
  let testAccountId: number

  const TEST_ACCOUNT = "0xabcd" as Address
  const TEST_SUBSCRIPTION_ID = "0x1234" as Hash
  const TEST_WEBHOOK_URL = "https://example.com/webhook"

  beforeEach(async () => {
    // Create test database with account
    testDB = await createTestDB({
      accounts: [TEST_ACCOUNT],
    })

    // Get account ID from test database
    const account = await testDB.db
      .prepare("SELECT id FROM accounts WHERE address = ?")
      .bind(TEST_ACCOUNT)
      .first<{ id: number }>()
    if (!account) {
      throw new Error("Test account not found in database")
    }
    testAccountId = account.id

    // Create service with test dependencies
    service = WebhookService.createForTesting({
      webhookRepository: new WebhookRepository({
        DB: testDB.db,
        LOGGING: "verbose",
      }),
      webhookQueue: {
        send: mockQueueSend,
        // biome-ignore lint/suspicious/noExplicitAny: Test mocks
      } as any,
    })

    // Reset mocks before each test
    mockQueueSend.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    // Clean up database
    await testDB.dispose()
    // Reset all mocks
    mock.clearAllMocks()
  })

  describe("setWebhook", () => {
    it("sets webhook URL successfully and generates secret", async () => {
      const result = await service.setWebhook({
        accountId: testAccountId,
        url: TEST_WEBHOOK_URL,
      })

      expect(result.url).toBe(TEST_WEBHOOK_URL)
      expect(result.secret).toMatch(/^whsec_[a-f0-9]{64}$/) // 32 bytes = 64 hex chars

      // Verify webhook was created in database
      const webhook = await testDB.db
        .prepare("SELECT * FROM webhooks WHERE account_id = ?")
        .bind(testAccountId)
        .first<{ url: string; secret: string }>()

      expect(webhook?.url).toBe(TEST_WEBHOOK_URL)
      expect(webhook?.secret).toBe(result.secret)
    })

    it("updates existing webhook URL and generates new secret", async () => {
      // Set initial webhook
      const result1 = await service.setWebhook({
        accountId: testAccountId,
        url: "https://example.com/old",
      })

      // Update to new URL
      const result2 = await service.setWebhook({
        accountId: testAccountId,
        url: TEST_WEBHOOK_URL,
      })

      expect(result2.url).toBe(TEST_WEBHOOK_URL)
      expect(result2.secret).not.toBe(result1.secret) // New secret generated

      // Verify only one webhook exists
      const count = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM webhooks WHERE account_id = ?")
        .bind(testAccountId)
        .first<{ count: number }>()

      expect(count?.count).toBe(1)
    })

    it("throws error for invalid webhook URL format", async () => {
      await expect(
        service.setWebhook({
          accountId: testAccountId,
          url: "not-a-valid-url",
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.setWebhook({
          accountId: testAccountId,
          url: "not-a-valid-url",
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
      }
    })
  })

  describe("emitSubscriptionActivated", () => {
    it("emits activation event and queues webhook", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      const activationResult: ActivationResult = {
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountId: testAccountId,
        provider: Provider.BASE,
        transaction: {
          hash: "0xtxhash" as Hash,
          amount: "500000",
        },
        order: {
          id: 1,
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

      await service.emitSubscriptionActivated(activationResult)

      // Verify queue was called
      expect(mockQueueSend).toHaveBeenCalledTimes(1)
      const queueMessage = mockQueueSend.mock.calls[0][0]

      expect(queueMessage.url).toBe(TEST_WEBHOOK_URL)
      expect(queueMessage.signature).toBeDefined()
      expect(queueMessage.timestamp).toBeGreaterThan(0)

      // Verify event structure
      const event = JSON.parse(queueMessage.payload)
      expect(event.type).toBe("subscription.updated")
      expect(event.data.subscription.id).toBe(TEST_SUBSCRIPTION_ID)
      expect(event.data.subscription.status).toBe(SubscriptionStatus.ACTIVE)
      expect(event.data.subscription.amount).toBe("500000")
      expect(event.data.order.number).toBe(1)
      expect(event.data.order.type).toBe(OrderType.INITIAL)
      expect(event.data.order.status).toBe("paid")
      expect(event.data.transaction.hash).toBe("0xtxhash")
    })

    it("does not throw if no webhook configured", async () => {
      const activationResult: ActivationResult = {
        subscriptionId: TEST_SUBSCRIPTION_ID,
        accountId: testAccountId,
        provider: Provider.BASE,
        transaction: { hash: "0xtxhash" as Hash, amount: "500000" },
        order: {
          id: 1,
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

      // Should not throw
      await expect(
        service.emitSubscriptionActivated(activationResult),
      ).resolves.toBeUndefined()

      // Queue should not be called
      expect(mockQueueSend).not.toHaveBeenCalled()
    })
  })

  describe("emitSubscriptionCreated", () => {
    it("emits creation event with subscription metadata only", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      await service.emitSubscriptionCreated({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "1000000",
        periodInSeconds: 2592000,
      })

      // Verify queue was called
      expect(mockQueueSend).toHaveBeenCalledTimes(1)
      const queueMessage = mockQueueSend.mock.calls[0][0]

      // Verify event structure (no order or transaction)
      const event = JSON.parse(queueMessage.payload)
      expect(event.data.subscription.status).toBe(SubscriptionStatus.PROCESSING)
      expect(event.data.subscription.amount).toBe("1000000")
      expect(event.data.order).toBeUndefined()
      expect(event.data.transaction).toBeUndefined()
    })
  })

  describe("emitPaymentProcessed", () => {
    it("emits payment success event with order and transaction", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      await service.emitPaymentProcessed({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        orderNumber: 2,
        amount: "1000000",
        transactionHash: "0xtxhash" as Hash,
        orderDueAt: new Date("2025-02-01T00:00:00Z"),
        orderPeriodInSeconds: 2592000,
      })

      // Verify queue was called
      expect(mockQueueSend).toHaveBeenCalledTimes(1)
      const queueMessage = mockQueueSend.mock.calls[0][0]

      // Verify event structure
      const event = JSON.parse(queueMessage.payload)
      expect(event.data.subscription.status).toBe(SubscriptionStatus.ACTIVE)
      expect(event.data.order.number).toBe(2)
      expect(event.data.order.type).toBe(OrderType.RECURRING)
      expect(event.data.order.status).toBe("paid")
      expect(event.data.order.current_period_start).toBe(1738368000) // 2025-02-01 UTC
      expect(event.data.transaction.hash).toBe("0xtxhash")
    })
  })

  describe("emitPaymentFailed", () => {
    it("emits payment failure event with error details", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      await service.emitPaymentFailed({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        orderNumber: 2,
        amount: "1000000",
        periodInSeconds: 2592000,
        failureReason: ErrorCode.INSUFFICIENT_BALANCE,
        failureMessage: "Insufficient USDC balance",
      })

      // Verify queue was called
      expect(mockQueueSend).toHaveBeenCalledTimes(1)
      const queueMessage = mockQueueSend.mock.calls[0][0]

      // Verify event structure
      const event = JSON.parse(queueMessage.payload)
      expect(event.data.subscription.status).toBe(SubscriptionStatus.PAST_DUE)
      expect(event.data.order.status).toBe("failed")
      expect(event.data.error.code).toBe(ErrorCode.INSUFFICIENT_BALANCE)
      expect(event.data.error.message).toBe("Insufficient USDC balance")
      expect(event.data.transaction).toBeUndefined()
    })

    it("includes next_retry_at when retry is scheduled", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      const nextRetryDate = new Date("2025-02-02T00:00:00Z")

      await service.emitPaymentFailed({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        subscriptionStatus: SubscriptionStatus.PAST_DUE,
        orderNumber: 2,
        amount: "1000000",
        periodInSeconds: 2592000,
        failureReason: ErrorCode.INSUFFICIENT_BALANCE,
        failureMessage: "Insufficient USDC balance",
        nextRetryAt: nextRetryDate,
      })

      // Verify queue was called
      const queueMessage = mockQueueSend.mock.calls[0][0]
      const event = JSON.parse(queueMessage.payload)

      expect(event.data.order.next_retry_at).toBe(
        Math.floor(nextRetryDate.getTime() / 1000),
      )
    })
  })

  describe("emitActivationFailed", () => {
    it("sanitizes payment errors for webhook exposure", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      // Payment error (402) should be exposed
      const paymentError = new HTTPError(
        402,
        ErrorCode.INSUFFICIENT_BALANCE,
        "Insufficient USDC balance",
      )

      await service.emitActivationFailed({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "500000",
        periodInSeconds: 2592000,
        error: paymentError,
      })

      // Verify queue was called
      const queueMessage = mockQueueSend.mock.calls[0][0]
      const event = JSON.parse(queueMessage.payload)

      expect(event.data.subscription.status).toBe(SubscriptionStatus.INCOMPLETE)
      expect(event.data.error.code).toBe(ErrorCode.INSUFFICIENT_BALANCE)
      expect(event.data.error.message).toBe("Insufficient USDC balance")
    })

    it("hides internal errors from webhook exposure", async () => {
      // Set up webhook
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "whsec_testsecret")
        .run()

      // Internal error (500) should be hidden
      const internalError = new HTTPError(
        500,
        ErrorCode.INTERNAL_ERROR,
        "Database connection failed",
      )

      await service.emitActivationFailed({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "500000",
        periodInSeconds: 2592000,
        error: internalError,
      })

      // Verify queue was called
      const queueMessage = mockQueueSend.mock.calls[0][0]
      const event = JSON.parse(queueMessage.payload)

      // Error should be sanitized
      expect(event.data.error.code).toBe("internal_error")
      expect(event.data.error.message).toBe("An internal error occurred")
    })
  })

  describe("emitSubscriptionCanceled", () => {
    it("emits subscription.updated webhook with canceled status", async () => {
      // Register webhook for the account
      await testDB.db
        .prepare(
          "INSERT INTO webhooks (account_id, url, secret) VALUES (?, ?, ?)",
        )
        .bind(testAccountId, TEST_WEBHOOK_URL, "test-secret")
        .run()

      await service.emitSubscriptionCanceled({
        accountId: testAccountId,
        subscriptionId: TEST_SUBSCRIPTION_ID,
        amount: "1000000",
        periodInSeconds: 2592000,
      })

      // Verify queue was called
      expect(mockQueueSend).toHaveBeenCalledTimes(1)

      const queueMessage = mockQueueSend.mock.calls[0][0]
      expect(queueMessage.url).toBe(TEST_WEBHOOK_URL)

      const event = JSON.parse(queueMessage.payload)
      expect(event.type).toBe("subscription.updated")
      expect(event.data.subscription.id).toBe(TEST_SUBSCRIPTION_ID)
      expect(event.data.subscription.status).toBe(SubscriptionStatus.CANCELED)
      expect(event.data.subscription.amount).toBe("1000000")
      expect(event.data.subscription.period_in_seconds).toBe(2592000)
      expect(event.data.order).toBeUndefined()
      expect(event.data.transaction).toBeUndefined()
      expect(event.data.error).toBeUndefined()
    })

    it("does not throw if no webhook configured", async () => {
      // No webhook registered for this account
      await expect(
        service.emitSubscriptionCanceled({
          accountId: testAccountId,
          subscriptionId: TEST_SUBSCRIPTION_ID,
          amount: "1000000",
          periodInSeconds: 2592000,
        }),
      ).resolves.toBeUndefined()

      // Queue should not be called
      expect(mockQueueSend).not.toHaveBeenCalled()
    })
  })
})
