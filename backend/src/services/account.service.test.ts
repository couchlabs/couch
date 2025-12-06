import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { D1Database } from "@cloudflare/workers-types"
import { createTestDB } from "@tests/test-db"
import { type Address, getAddress } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"

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
        .prepare("INSERT INTO accounts (address) VALUES (?)")
        .bind(TEST_ACCOUNT)
        .run()

      const exists = await service.accountExists(TEST_ACCOUNT)

      expect(exists).toBe(true)
    })
  })

  describe("createAccount", () => {
    it("creates account successfully when address is allowlisted and doesn't exist", async () => {
      const result = await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Should return wallet address only (API keys managed separately)
      expect(result.subscriptionOwnerWalletAddress).toBeDefined()
      expect(result.subscriptionOwnerWalletAddress).toMatch(
        /^0x[a-fA-F0-9]{40}$/,
      )

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

      expect(result).toHaveProperty("subscriptionOwnerWalletAddress")
      expect(result.subscriptionOwnerWalletAddress).toMatch(
        /^0x[a-fA-F0-9]{40}$/,
      )
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

  describe("rotateApiKey", () => {
    it("rotates API key successfully for existing account", async () => {
      // Create account first (no API key returned)
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Get account ID from database
      const account = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()
      if (!account) {
        throw new Error("Test account not found in database")
      }

      const { apiKey: rotatedKey, subscriptionOwnerWalletAddress } =
        await service.rotateApiKey(account.id)

      // Should return new API key
      expect(rotatedKey).toBeDefined()
      expect(rotatedKey).toMatch(/^ck_[a-f0-9]{32}$/)
      expect(subscriptionOwnerWalletAddress).toBeDefined()

      // Verify only one key exists
      const keyCount = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE account_id = ?")
        .bind(account.id)
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(1)

      // Verify new key works
      const authenticatedAccount = await service.authenticateApiKey(rotatedKey)
      expect(authenticatedAccount.address).toBe(TEST_ACCOUNT)
    })

    it("generates different keys on multiple rotations", async () => {
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Get account ID from database
      const account = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()
      if (!account) {
        throw new Error("Test account not found in database")
      }

      const keys = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const { apiKey } = await service.rotateApiKey(account.id)
        keys.add(apiKey)
      }

      expect(keys.size).toBe(5)
    })
  })

  describe("authenticateApiKey", () => {
    it("authenticates valid API key and returns account", async () => {
      // Create account
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Get account ID and rotate to get an API key
      const accountRecord = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()
      if (!accountRecord) throw new Error("Account not created")

      const { apiKey } = await service.rotateApiKey(accountRecord.id)

      const account = await service.authenticateApiKey(apiKey)

      expect(account.address).toBe(TEST_ACCOUNT)
      expect(account.id).toBeDefined()
      expect(typeof account.id).toBe("number")
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

    it("authenticates key after rotation", async () => {
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Get account ID from database
      const accountRecord = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()
      if (!accountRecord) {
        throw new Error("Test account not found in database")
      }

      const { apiKey: newKey } = await service.rotateApiKey(accountRecord.id)

      const account = await service.authenticateApiKey(newKey)
      expect(account.address).toBe(TEST_ACCOUNT)
      expect(account.id).toBeDefined()
    })
  })

  describe("getOrCreateAccount", () => {
    it("validates and normalizes address format", async () => {
      // Use lowercase address (should be normalized to checksummed)
      const lowercaseAddress = TEST_ACCOUNT.toLowerCase()

      const result = await service.getOrCreateAccount({
        address: lowercaseAddress,
      })

      expect(result.success).toBe(true)

      // Verify account was created with checksummed address
      const account = await testDB.db
        .prepare("SELECT address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ address: string }>()

      expect(account?.address).toBe(TEST_ACCOUNT) // Checksummed version
    })

    it("throws 400 when address format is invalid", async () => {
      try {
        await service.getOrCreateAccount({
          address: "invalid-address",
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
      })

      expect(result.success).toBe(true)

      // Verify account was created
      const account = await testDB.db
        .prepare("SELECT id, address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number; address: string }>()

      expect(account).not.toBeNull()
      expect(account?.address).toBe(TEST_ACCOUNT)
      expect(account?.id).toBeDefined()
    })

    it("returns success for existing account (idempotent)", async () => {
      // Create account first
      await service.createAccount({ address: TEST_ACCOUNT })

      // Call getOrCreateAccount - should return success without error
      const result = await service.getOrCreateAccount({
        address: TEST_ACCOUNT,
      })

      expect(result.success).toBe(true)

      // Verify only one account exists
      const count = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ count: number }>()

      expect(count?.count).toBe(1)
    })

    it("returns success for existing account with different case", async () => {
      // Create account with checksummed address
      await service.createAccount({ address: TEST_ACCOUNT })

      // Call with lowercase address
      const result = await service.getOrCreateAccount({
        address: TEST_ACCOUNT.toLowerCase(),
      })

      expect(result.success).toBe(true)

      // Verify only one account exists
      const count = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM accounts")
        .first<{ count: number }>()

      expect(count?.count).toBe(1)
    })
  })
})
