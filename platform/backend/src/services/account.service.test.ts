import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import { createTestDB } from "@backend-tests/test-db"
import type { D1Database } from "@cloudflare/workers-types"
import { type Address, getAddress } from "viem"

// Mock the CDP wallet creation module
// IMPORTANT: Must be defined BEFORE importing AccountService for mock.module() to work
const mockWalletCreation = mock(async () => ({
  address: "0x1234567890123456789012345678901234567890",
  walletName: "merchant-1",
  eoaAddress: "0x0987654321098765432109876543210987654321",
}))

mock.module("@base-org/account/node", () => ({
  getOrCreateSubscriptionOwnerWallet: mockWalletCreation,
}))

// Import AccountService AFTER setting up the mock
import { AccountService } from "./account.service"

describe("AccountService", () => {
  let dispose: (() => Promise<void>) | undefined
  let testDB: {
    db: D1Database
    orderIds: number[]
    dispose: () => Promise<void>
  }
  let service: AccountService

  const TEST_ACCOUNT = getAddress(
    "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  ) as Address
  const TEST_CDP_USER_ID = "test-cdp-user-123"
  const TEST_ACCOUNT_2 = getAddress(
    "0x8888888888888888888888888888888888888888",
  ) as Address
  const TEST_ACCOUNT_NOT_ALLOWED = getAddress(
    "0x1234567890123456789012345678901234567890",
  ) as Address

  beforeEach(async () => {
    // Create test database
    testDB = await createTestDB({
      accounts: [], // Start with no accounts
    })
    dispose = testDB.dispose

    // Create service instance with CDP credentials
    service = new AccountService({
      DB: testDB.db,
      LOGGING: "verbose",
      CDP_API_KEY_ID: "test-api-key-id",
      CDP_API_KEY_SECRET: "test-api-key-secret",
      CDP_WALLET_SECRET: "test-wallet-secret",
    })
  })

  afterEach(async () => {
    // Wait for any pending background operations to complete
    await service.waitForPendingUpdates()

    // Clean up database
    if (dispose) {
      await dispose()
    }
    // Reset all mocks
    mock.clearAllMocks()
  })

  // NOTE: Allowlist removed - authentication now handled by CDP at merchant app level

  describe("accountExists", () => {
    it("returns true when account exists", async () => {
      // Create account first
      await service.createAccount({ address: TEST_ACCOUNT })

      const exists = await service.accountExists(TEST_ACCOUNT)
      expect(exists).toBe(true)
    })

    it("returns false when account does not exist", async () => {
      const exists = await service.accountExists(TEST_ACCOUNT_NOT_ALLOWED)
      expect(exists).toBe(false)
    })
  })

  describe("accountExists", () => {
    it("returns false when account does not exist", async () => {
      const exists = await service.accountExists(TEST_ACCOUNT)

      expect(exists).toBe(false)
    })

    it("returns true when account exists", async () => {
      // Create account in database
      await testDB.db
        .prepare(
          "INSERT INTO accounts (address, subscription_owner_address) VALUES (?, ?)",
        )
        .bind(TEST_ACCOUNT, null)
        .run()

      const exists = await service.accountExists(TEST_ACCOUNT)

      expect(exists).toBe(true)
    })
  })

  describe("createAccount", () => {
    it("creates account successfully and returns full Account object with subscriptionOwnerAddress", async () => {
      const result = await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Should return full Account object with subscription owner address set (not null)
      expect(result.id).toBeDefined()
      expect(result.address).toBe(TEST_ACCOUNT)
      expect(result.subscriptionOwnerAddress).not.toBeNull()
      expect(result.subscriptionOwnerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(result.createdAt).toBeDefined()
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/)

      // Verify account was created in database
      const account = await testDB.db
        .prepare("SELECT id, address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number; address: string }>()

      expect(account?.address).toBe(TEST_ACCOUNT)
      expect(account?.id).toBeDefined()

      // Verify account was created (no API key - managed separately)
      expect(account).not.toBeNull()
      const keyCount = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE account_id = ?")
        .bind(account?.id)
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(0) // No API key created
    })

    // NOTE: Allowlist check removed - authentication now handled by CDP at merchant app level
    it("creates account successfully (no allowlist check)", async () => {
      const result = await service.createAccount({
        address: TEST_ACCOUNT_NOT_ALLOWED,
      })

      expect(result).toHaveProperty("subscriptionOwnerAddress")
      expect(result.subscriptionOwnerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it("throws 409 when account already exists", async () => {
      // Create account first
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Try to create again
      try {
        await service.createAccount({
          address: TEST_ACCOUNT,
        })
        expect.unreachable("Should have thrown HTTPError")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.ACCOUNT_EXISTS)
        expect((error as HTTPError).status).toBe(409)
      }
    })

    // NOTE: Address validation tests removed - createAccount() trusts caller to validate
    // Validation is now done in getOrCreateAccount() which is the public entry point

    it("rolls back account creation if wallet creation fails", async () => {
      mockWalletCreation.mockImplementationOnce(async () => {
        throw new Error("CDP wallet creation failed")
      })

      await expect(
        service.createAccount({
          address: TEST_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      // Verify account was rolled back (not in database)
      const account = await testDB.db
        .prepare("SELECT address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ address: string }>()

      expect(account).toBeNull()

      // Verify no API key was created
      const keyCount = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM api_keys")
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(0)
    })
  })

  describe("API Key CRUD Operations", () => {
    describe("createApiKey", () => {
      it("creates a new API key with valid name", async () => {
        // Create account first
        await service.createAccount({ address: TEST_ACCOUNT })

        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        // Create API key
        const result = await service.createApiKey({
          accountId: account.id,
          name: "Test Key",
        })

        // Verify response
        expect(result.id).toBeDefined()
        expect(result.apiKey).toBeDefined()
        expect(result.apiKey).toMatch(/^ck_[a-f0-9]{32}$/)
        expect(result.name).toBe("Test Key")
        expect(result.prefix).toBe("ck_")
        expect(result.start).toBeDefined()
        expect(result.start.length).toBe(6)
        expect(result.enabled).toBe(true)
        expect(result.createdAt).toBeDefined()

        // Verify it's in the database
        const dbKey = await testDB.db
          .prepare("SELECT * FROM api_keys WHERE id = ?")
          .bind(result.id)
          .first<{ name: string; enabled: number }>()

        expect(dbKey).toBeDefined()
        expect(dbKey?.name).toBe("Test Key")
        expect(dbKey?.enabled).toBe(1)
      })

      it("generates default name when not provided", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const result1 = await service.createApiKey({
          accountId: account.id,
        })
        expect(result1.name).toBe("API Key 1")

        const result2 = await service.createApiKey({
          accountId: account.id,
        })
        expect(result2.name).toBe("API Key 2")
      })

      it("trims whitespace from key name", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const result = await service.createApiKey({
          accountId: account.id,
          name: "  Trimmed Key  ",
        })

        expect(result.name).toBe("Trimmed Key")
      })

      it("throws error when name is empty string", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        try {
          await service.createApiKey({
            accountId: account.id,
            name: "",
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(400)
          expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
        }
      })

      it("throws error when name is too long", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const longName = "a".repeat(33)

        try {
          await service.createApiKey({
            accountId: account.id,
            name: longName,
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(400)
          expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
        }
      })

      it("creates multiple keys for the same account", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const key1 = await service.createApiKey({
          accountId: account.id,
          name: "Key 1",
        })
        const key2 = await service.createApiKey({
          accountId: account.id,
          name: "Key 2",
        })

        expect(key1.id).not.toBe(key2.id)
        expect(key1.apiKey).not.toBe(key2.apiKey)

        // Verify both exist in database
        const count = await testDB.db
          .prepare(
            "SELECT COUNT(*) as count FROM api_keys WHERE account_id = ?",
          )
          .bind(account.id)
          .first<{ count: number }>()

        expect(count?.count).toBe(2)
      })
    })

    describe("listApiKeys", () => {
      it("lists all keys for an account", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        // Create multiple keys
        await service.createApiKey({ accountId: account.id, name: "Key 1" })
        await service.createApiKey({ accountId: account.id, name: "Key 2" })
        await service.createApiKey({ accountId: account.id, name: "Key 3" })

        const keys = await service.listApiKeys({ accountId: account.id })

        expect(keys.length).toBe(3)
        expect(keys.map((k) => k.name)).toEqual(
          expect.arrayContaining(["Key 1", "Key 2", "Key 3"]),
        )

        // Verify no keyHash in response (security)
        keys.forEach((key) => {
          expect(key).not.toHaveProperty("keyHash")
          expect(key.id).toBeDefined()
          expect(key.name).toBeDefined()
          expect(key.prefix).toBe("ck_")
          expect(key.start).toBeDefined()
          expect(key.enabled).toBe(true)
          expect(key.createdAt).toBeDefined()
        })
      })

      it("returns empty array when no keys exist", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const keys = await service.listApiKeys({ accountId: account.id })

        expect(keys).toEqual([])
      })

      it("returns all keys for an account", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        await service.createApiKey({
          accountId: account.id,
          name: "First",
        })
        await service.createApiKey({
          accountId: account.id,
          name: "Second",
        })

        const keys = await service.listApiKeys({ accountId: account.id })

        // Should return both keys
        expect(keys).toHaveLength(2)
        const names = keys.map((k) => k.name).sort()
        expect(names).toEqual(["First", "Second"])
      })
    })

    describe("updateApiKey", () => {
      it("updates key name", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const created = await service.createApiKey({
          accountId: account.id,
          name: "Old Name",
        })

        const updated = await service.updateApiKey({
          accountId: account.id,
          keyId: created.id,
          name: "New Name",
        })

        expect(updated.name).toBe("New Name")
        expect(updated.id).toBe(created.id)
      })

      it("updates enabled status", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const created = await service.createApiKey({
          accountId: account.id,
          name: "Test Key",
        })

        const updated = await service.updateApiKey({
          accountId: account.id,
          keyId: created.id,
          enabled: false,
        })

        expect(updated.enabled).toBe(false)
      })

      it("updates both name and enabled status", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const created = await service.createApiKey({
          accountId: account.id,
          name: "Old Name",
        })

        const updated = await service.updateApiKey({
          accountId: account.id,
          keyId: created.id,
          name: "New Name",
          enabled: false,
        })

        expect(updated.name).toBe("New Name")
        expect(updated.enabled).toBe(false)
      })

      it("throws error when key not found", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        try {
          await service.updateApiKey({
            accountId: account.id,
            keyId: 99999,
            name: "New Name",
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(404)
        }
      })

      it("throws error when name is empty", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const created = await service.createApiKey({
          accountId: account.id,
          name: "Test Key",
        })

        try {
          await service.updateApiKey({
            accountId: account.id,
            keyId: created.id,
            name: "   ",
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(400)
        }
      })

      it("enforces account ownership", async () => {
        // Create two accounts
        await service.createAccount({ address: TEST_ACCOUNT })
        await service.createAccount({ address: TEST_ACCOUNT_2 })

        const account1 = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        const account2 = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT_2)
          .first<{ id: number }>()
        if (!account1 || !account2) throw new Error("Accounts not created")

        // Create key for account1
        const key = await service.createApiKey({
          accountId: account1.id,
          name: "Account 1 Key",
        })

        // Try to update it using account2's ID
        try {
          await service.updateApiKey({
            accountId: account2.id,
            keyId: key.id,
            name: "Hacked",
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(404)
        }
      })
    })

    describe("deleteApiKey", () => {
      it("deletes a key", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        const created = await service.createApiKey({
          accountId: account.id,
          name: "To Delete",
        })

        const result = await service.deleteApiKey({
          accountId: account.id,
          keyId: created.id,
        })

        expect(result.success).toBe(true)

        // Verify it's gone from database
        const dbKey = await testDB.db
          .prepare("SELECT * FROM api_keys WHERE id = ?")
          .bind(created.id)
          .first()

        expect(dbKey).toBeNull()
      })

      it("throws error when key not found", async () => {
        await service.createAccount({ address: TEST_ACCOUNT })
        const account = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        if (!account) throw new Error("Account not created")

        try {
          await service.deleteApiKey({
            accountId: account.id,
            keyId: 99999,
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(404)
        }
      })

      it("enforces account ownership", async () => {
        // Create two accounts
        await service.createAccount({ address: TEST_ACCOUNT })
        await service.createAccount({ address: TEST_ACCOUNT_2 })

        const account1 = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT)
          .first<{ id: number }>()
        const account2 = await testDB.db
          .prepare("SELECT id FROM accounts WHERE address = ?")
          .bind(TEST_ACCOUNT_2)
          .first<{ id: number }>()
        if (!account1 || !account2) throw new Error("Accounts not created")

        // Create key for account1
        const key = await service.createApiKey({
          accountId: account1.id,
          name: "Account 1 Key",
        })

        // Try to delete it using account2's ID
        try {
          await service.deleteApiKey({
            accountId: account2.id,
            keyId: key.id,
          })
          expect.unreachable("Should have thrown HTTPError")
        } catch (error) {
          expect(error).toBeInstanceOf(HTTPError)
          expect((error as HTTPError).status).toBe(404)
        }

        // Verify key still exists
        const dbKey = await testDB.db
          .prepare("SELECT * FROM api_keys WHERE id = ?")
          .bind(key.id)
          .first()

        expect(dbKey).toBeDefined()
      })
    })
  })

  describe("authenticateApiKey", () => {
    it("authenticates valid API key and returns account", async () => {
      // Create account
      await service.createAccount({ address: TEST_ACCOUNT })

      const account = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()
      if (!account) throw new Error("Account not created")

      // Create API key
      const { apiKey } = await service.createApiKey({
        accountId: account.id,
        name: "Test Key",
      })

      // Authenticate with the key
      const authenticatedAccount = await service.authenticateApiKey(apiKey)

      expect(authenticatedAccount.address).toBe(TEST_ACCOUNT)
      expect(authenticatedAccount.id).toBe(account.id)
    })

    it("throws 401 when API key is disabled", async () => {
      // Create account
      await service.createAccount({ address: TEST_ACCOUNT })

      const account = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()
      if (!account) throw new Error("Account not created")

      // Create and then disable API key
      const { apiKey, id } = await service.createApiKey({
        accountId: account.id,
        name: "Test Key",
      })

      await service.updateApiKey({
        accountId: account.id,
        keyId: id,
        enabled: false,
      })

      // Try to authenticate with disabled key
      try {
        await service.authenticateApiKey(apiKey)
        expect.unreachable("Should have thrown HTTPError")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_API_KEY)
        expect((error as HTTPError).status).toBe(401)
      }
    })

    it("throws 401 when API key is invalid", async () => {
      try {
        await service.authenticateApiKey("ck_invalid")
        expect.unreachable("Should have thrown HTTPError")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_API_KEY)
        expect((error as HTTPError).status).toBe(401)
      }
    })
  })

  describe("getOrCreateAccount", () => {
    it("validates and normalizes address format", async () => {
      // Use lowercase address (should be normalized to checksummed)
      const lowercaseAddress = TEST_ACCOUNT.toLowerCase()

      const result = await service.getOrCreateAccount({
        address: lowercaseAddress,
        cdpUserId: TEST_CDP_USER_ID,
      })

      // Should return full Account object
      expect(result.id).toBeDefined()
      expect(result.address).toBe(TEST_ACCOUNT) // Checksummed version
      expect(result.subscriptionOwnerAddress).not.toBeNull()
      expect(result.createdAt).toBeDefined()
    })

    it("throws 400 when address format is invalid", async () => {
      try {
        await service.getOrCreateAccount({
          address: "invalid-address",
          cdpUserId: TEST_CDP_USER_ID,
        })
        expect.unreachable("Should have thrown HTTPError")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
        expect((error as HTTPError).status).toBe(400)
      }
    })

    it("creates new account successfully", async () => {
      const result = await service.getOrCreateAccount({
        address: TEST_ACCOUNT,
        cdpUserId: TEST_CDP_USER_ID,
      })

      // Should return full Account object
      expect(result.id).toBeDefined()
      expect(result.address).toBe(TEST_ACCOUNT)
      expect(result.subscriptionOwnerAddress).not.toBeNull()
      expect(result.createdAt).toBeDefined()
    })

    it("returns existing account (idempotent)", async () => {
      // Create account first with CDP user ID
      const created = await service.createAccount({
        address: TEST_ACCOUNT,
        cdpUserId: TEST_CDP_USER_ID,
      })

      // Call getOrCreateAccount - should return existing account
      const result = await service.getOrCreateAccount({
        address: TEST_ACCOUNT,
        cdpUserId: TEST_CDP_USER_ID,
      })

      // Should return the same account
      expect(result.id).toBe(created.id)
      expect(result.address).toBe(TEST_ACCOUNT)
      expect(result.subscriptionOwnerAddress).toBe(
        created.subscriptionOwnerAddress,
      )
      expect(result.createdAt).toBe(created.createdAt)

      // Verify only one account exists
      const count = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ count: number }>()

      expect(count?.count).toBe(1)
    })

    it("returns existing account with different case", async () => {
      // Create account with checksummed address
      const created = await service.createAccount({
        address: TEST_ACCOUNT,
        cdpUserId: TEST_CDP_USER_ID,
      })

      // Call with lowercase address - should return same account
      const result = await service.getOrCreateAccount({
        address: TEST_ACCOUNT.toLowerCase(),
        cdpUserId: TEST_CDP_USER_ID,
      })

      // Should return the same account (normalized to checksummed)
      expect(result.id).toBe(created.id)
      expect(result.address).toBe(TEST_ACCOUNT) // Checksummed
      expect(result.subscriptionOwnerAddress).toBe(
        created.subscriptionOwnerAddress,
      )
      expect(result.createdAt).toBe(created.createdAt)

      // Verify only one account exists
      const count = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM accounts")
        .first<{ count: number }>()

      expect(count?.count).toBe(1)
    })
  })
})
