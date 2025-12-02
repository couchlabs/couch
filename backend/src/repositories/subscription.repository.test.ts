import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createTestDB } from "@tests/test-db"
import type { Address, Hash } from "viem"
import {
  OrderStatus,
  OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import { Provider } from "@/providers/provider.interface"
import { SubscriptionRepository } from "./subscription.repository"

describe("SubscriptionRepository", () => {
  let repo: SubscriptionRepository
  let dispose: (() => Promise<void>) | undefined
  let testAccountId: number
  const TEST_ACCOUNT = "0xabcd" as Address

  beforeEach(async () => {
    // Create in-memory test database with migrations and test account
    const testDB = await createTestDB({
      accounts: [TEST_ACCOUNT],
    })
    dispose = testDB.dispose

    // Get the account ID for test usage
    const account = await testDB.db
      .prepare("SELECT id FROM accounts WHERE address = ?")
      .bind(TEST_ACCOUNT)
      .first<{ id: number }>()

    if (!account) throw new Error("Test account not created")
    testAccountId = account.id

    // Initialize repository
    repo = new SubscriptionRepository({
      DB: testDB.db,
      LOGGING: "verbose",
    })
  })

  afterEach(async () => {
    // Clean up database
    if (dispose) {
      await dispose()
    }
  })

  describe("createSubscription", () => {
    it("creates a new subscription", async () => {
      const created = await repo.createSubscription({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
      })

      expect(created).toBe(true)
    })

    it("prevents duplicate subscription IDs (returns false on conflict)", async () => {
      const params = {
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
      }

      const first = await repo.createSubscription(params)
      expect(first).toBe(true)

      // Second attempt should return false (conflict)
      const second = await repo.createSubscription(params)
      expect(second).toBe(false)
    })
  })

  describe("subscriptionExists", () => {
    it("returns false for non-existent subscription", async () => {
      const exists = await repo.subscriptionExists({
        subscriptionId: "0xnonexistent" as Hash,
      })
      expect(exists).toBe(false)
    })

    it("returns true for existing subscription", async () => {
      await repo.createSubscription({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
      })

      const exists = await repo.subscriptionExists({
        subscriptionId: "0x1234" as Hash,
      })
      expect(exists).toBe(true)
    })
  })

  describe("createSubscriptionWithOrder", () => {
    it("creates subscription and initial order atomically", async () => {
      const result = await repo.createSubscriptionWithOrder({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: new Date().toISOString(),
          amount: "1000000",
          periodInSeconds: 2592000, // 30 days
          status: OrderStatus.PROCESSING,
        },
      })

      expect(result.created).toBe(true)
      if (result.created) {
        expect(result.orderId).toBeDefined()
        expect(result.orderNumber).toBe(1) // First order
      }
    })

    it("returns false when subscription already exists", async () => {
      const params = {
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: new Date().toISOString(),
          amount: "1000000",
          periodInSeconds: 2592000,
          status: OrderStatus.PROCESSING,
        },
      }

      const first = await repo.createSubscriptionWithOrder(params)
      expect(first.created).toBe(true)

      const second = await repo.createSubscriptionWithOrder(params)
      expect(second.created).toBe(false)
    })
  })

  describe("getOrderDetails", () => {
    it("returns null for non-existent order", async () => {
      const details = await repo.getOrderDetails(999)
      expect(details).toBeNull()
    })

    it("retrieves order details with subscription info", async () => {
      // First create subscription with order
      const result = await repo.createSubscriptionWithOrder({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: "2025-01-01T00:00:00Z",
          amount: "1000000",
          periodInSeconds: 2592000,
          status: OrderStatus.PROCESSING,
        },
      })

      if (!result.created)
        throw new Error("Expected subscription to be created")

      const details = await repo.getOrderDetails(result.orderId)
      expect(details).toMatchObject({
        id: result.orderId,
        subscriptionId: "0x1234",
        accountId: testAccountId,
        amount: "1000000",
        orderNumber: 1,
        status: OrderStatus.PROCESSING,
        periodInSeconds: 2592000,
      })
    })
  })

  describe("claimDueOrders", () => {
    it("claims pending orders that are due for active subscriptions", async () => {
      // Create subscription with order
      const result = await repo.createSubscriptionWithOrder({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: "2020-01-01T00:00:00Z", // Past due
          amount: "1000000",
          periodInSeconds: 2592000,
          status: OrderStatus.PROCESSING,
        },
      })

      if (!result.created)
        throw new Error("Expected subscription to be created")

      // Activate the subscription first
      await repo.updateSubscription({
        subscriptionId: "0x1234" as Hash,
        status: SubscriptionStatus.ACTIVE,
      })

      // Update order to pending
      await repo.updateOrder({
        id: result.orderId,
        status: OrderStatus.PENDING,
      })

      // Claim due orders
      const claimed = await repo.claimDueOrders(10)
      expect(claimed.length).toBe(1)
      expect(claimed[0].id).toBe(result.orderId)
      expect(claimed[0].subscriptionId).toBe("0x1234")
    })

    it("respects the limit parameter", async () => {
      // Create multiple subscriptions with orders
      for (let i = 0; i < 3; i++) {
        const subscriptionId = `0x${i}234` as Hash
        const result = await repo.createSubscriptionWithOrder({
          subscriptionId,
          accountId: testAccountId,
          beneficiaryAddress: "0x5678" as Address,
          provider: Provider.BASE,
          order: {
            subscriptionId,
            type: OrderType.INITIAL,
            dueAt: "2020-01-01T00:00:00Z",
            amount: "1000000",
            periodInSeconds: 2592000,
            status: OrderStatus.PROCESSING,
          },
        })

        if (!result.created)
          throw new Error("Expected subscription to be created")

        await repo.updateSubscription({
          subscriptionId,
          status: SubscriptionStatus.ACTIVE,
        })

        await repo.updateOrder({
          id: result.orderId,
          status: OrderStatus.PENDING,
        })
      }

      const claimed = await repo.claimDueOrders(2) // Only claim 2
      expect(claimed.length).toBe(2)
    })
  })

  describe("scheduleRetry", () => {
    it("updates order and subscription for retry", async () => {
      const result = await repo.createSubscriptionWithOrder({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: new Date().toISOString(),
          amount: "1000000",
          periodInSeconds: 2592000,
          status: OrderStatus.PROCESSING,
        },
      })

      if (!result.created)
        throw new Error("Expected subscription to be created")

      await repo.scheduleRetry({
        orderId: result.orderId,
        subscriptionId: "0x1234" as Hash,
        nextRetryAt: "2025-01-03T00:00:00Z",
        failureReason: "INSUFFICIENT_BALANCE",
      })

      const details = await repo.getOrderDetails(result.orderId)
      expect(details?.status).toBe(OrderStatus.FAILED)
      expect(details?.attempts).toBe(1)
    })
  })

  describe("getDueRetries", () => {
    it("returns orders ready for retry", async () => {
      const result = await repo.createSubscriptionWithOrder({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: "2020-01-01T00:00:00Z",
          amount: "1000000",
          periodInSeconds: 2592000,
          status: OrderStatus.PROCESSING,
        },
      })

      if (!result.created)
        throw new Error("Expected subscription to be created")

      // Schedule retry with past retry date
      await repo.scheduleRetry({
        orderId: result.orderId,
        subscriptionId: "0x1234" as Hash,
        nextRetryAt: "2020-01-02T00:00:00Z", // Past due
      })

      const retries = await repo.getDueRetries(10)
      expect(retries.length).toBe(1)
      expect(retries[0].id).toBe(result.orderId)
      expect(retries[0].subscriptionId).toBe("0x1234")
      expect(retries[0].attempts).toBe(1)
    })

    it("does not return future retries", async () => {
      const result = await repo.createSubscriptionWithOrder({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
        order: {
          subscriptionId: "0x1234" as Hash,
          type: OrderType.INITIAL,
          dueAt: "2020-01-01T00:00:00Z",
          amount: "1000000",
          periodInSeconds: 2592000,
          status: OrderStatus.PROCESSING,
        },
      })

      if (!result.created)
        throw new Error("Expected subscription to be created")

      // Schedule retry with future date
      await repo.scheduleRetry({
        orderId: result.orderId,
        subscriptionId: "0x1234" as Hash,
        nextRetryAt: "2099-01-01T00:00:00Z", // Far future
      })

      const retries = await repo.getDueRetries(10)
      expect(retries.length).toBe(0)
    })
  })

  describe("updateSubscription", () => {
    it("updates subscription status", async () => {
      await repo.createSubscription({
        subscriptionId: "0x1234" as Hash,
        accountId: testAccountId,
        beneficiaryAddress: "0x5678" as Address,
        provider: Provider.BASE,
      })

      await repo.updateSubscription({
        subscriptionId: "0x1234" as Hash,
        status: SubscriptionStatus.ACTIVE,
      })

      const exists = await repo.subscriptionExists({
        subscriptionId: "0x1234" as Hash,
      })
      expect(exists).toBe(true)
    })
  })
})
