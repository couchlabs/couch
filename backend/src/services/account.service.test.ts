import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { D1Database } from "@cloudflare/workers-types"
import { createTestDB } from "@tests/test-db"
import { type Address, getAddress } from "viem"
import type { Network } from "@/constants/env.constants"
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
  let mockAllowlist: {
    get: ReturnType<typeof mock>
  }

  const TEST_ACCOUNT = getAddress(
    "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  ) as Address
  const TEST_ACCOUNT_NOT_ALLOWED = getAddress(
    "0x1234567890123456789012345678901234567890",
  ) as Address
  const NETWORK: Network = "testnet"

  beforeEach(async () => {
    // Create test database
    testDB = await createTestDB({
      accounts: [], // Start with no accounts
    })
    dispose = testDB.dispose

    // Create mock ALLOWLIST KV namespace
    mockAllowlist = {
      get: mock(),
    }

    // Default behavior: TEST_ACCOUNT is allowlisted, TEST_ACCOUNT_NOT_ALLOWED is not
    // Use case-insensitive comparison since addresses might be in different cases
    mockAllowlist.get.mockImplementation(async (key: string) => {
      if (key.toLowerCase() === TEST_ACCOUNT.toLowerCase()) {
        return "2025-01-01T00:00:00.000Z" // Allowlisted (value is timestamp)
      }
      return null // Not in allowlist
    })

    // Create service instance with mocked ALLOWLIST and CDP credentials
    service = new AccountService({
      DB: testDB.db,
      LOGGING: "verbose",
      NETWORK,
      ALLOWLIST: mockAllowlist,
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

  describe("isAddressAllowed", () => {
    it("returns true when address is in allowlist", async () => {
      const isAllowed = await service.isAddressAllowed(TEST_ACCOUNT)

      expect(isAllowed).toBe(true)
      expect(mockAllowlist.get).toHaveBeenCalledWith(TEST_ACCOUNT)
    })

    it("returns false when address is not in allowlist", async () => {
      const isAllowed = await service.isAddressAllowed(TEST_ACCOUNT_NOT_ALLOWED)

      expect(isAllowed).toBe(false)
      expect(mockAllowlist.get).toHaveBeenCalledWith(TEST_ACCOUNT_NOT_ALLOWED)
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

      // Should return API key and wallet address
      expect(result.apiKey).toBeDefined()
      expect(result.apiKey).toMatch(/^ck_testnet_[a-f0-9]{32}$/)
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

      // Verify API key was created (using account_id foreign key)
      expect(account).not.toBeNull()
      const keyCount = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE account_id = ?")
        .bind(account?.id)
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(1)
    })

    it("throws 403 when address is not allowlisted", async () => {
      try {
        await service.createAccount({
          address: TEST_ACCOUNT_NOT_ALLOWED,
        })
        expect.unreachable("Should have thrown HTTPError")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.ADDRESS_NOT_ALLOWED)
        expect((error as HTTPError).status).toBe(403)
      }
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

    it("throws 400 when address format is invalid", async () => {
      try {
        await service.createAccount({
          address: "not-a-valid-address",
        })
        expect.unreachable("Should have thrown HTTPError")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
        expect((error as HTTPError).status).toBe(400)
      }
    })

    it("normalizes address to checksummed format", async () => {
      const lowercaseAddress = TEST_ACCOUNT.toLowerCase()

      await service.createAccount({
        address: lowercaseAddress,
      })

      // Verify address was stored in checksummed format
      const account = await testDB.db
        .prepare("SELECT address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ address: string }>()

      expect(account?.address).toBe(TEST_ACCOUNT)
    })

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
      const { apiKey: initialKey } = await service.createAccount({
        address: TEST_ACCOUNT,
      })

      const { apiKey: rotatedKey, subscriptionOwnerWalletAddress } =
        await service.rotateApiKey(TEST_ACCOUNT)

      // Keys should be different
      expect(rotatedKey).not.toBe(initialKey)
      expect(rotatedKey).toMatch(/^ck_testnet_[a-f0-9]{32}$/)
      expect(subscriptionOwnerWalletAddress).toBeDefined()

      // Verify only one key exists
      const account = await testDB.db
        .prepare("SELECT id FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ id: number }>()

      expect(account).not.toBeNull()
      const keyCount = await testDB.db
        .prepare("SELECT COUNT(*) as count FROM api_keys WHERE account_id = ?")
        .bind(account?.id)
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(1)

      // Verify old key no longer works
      await expect(service.authenticateApiKey(initialKey)).rejects.toThrow(
        HTTPError,
      )

      // Verify new key works
      const authenticatedAccount = await service.authenticateApiKey(rotatedKey)
      expect(authenticatedAccount.address).toBe(TEST_ACCOUNT)
    })

    it("generates different keys on multiple rotations", async () => {
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      const keys = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const { apiKey } = await service.rotateApiKey(TEST_ACCOUNT)
        keys.add(apiKey)
      }

      expect(keys.size).toBe(5)
    })
  })

  describe("authenticateApiKey", () => {
    it("authenticates valid API key and returns account", async () => {
      const { apiKey } = await service.createAccount({
        address: TEST_ACCOUNT,
      })

      const account = await service.authenticateApiKey(apiKey)

      expect(account.address).toBe(TEST_ACCOUNT)
      expect(account.id).toBeDefined()
      expect(typeof account.id).toBe("number")
    })

    it("throws 401 when API key is invalid", async () => {
      try {
        await service.authenticateApiKey("ck_testnet_invalid")
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

      const { apiKey: newKey } = await service.rotateApiKey(TEST_ACCOUNT)

      const account = await service.authenticateApiKey(newKey)
      expect(account.address).toBe(TEST_ACCOUNT)
      expect(account.id).toBeDefined()
    })
  })
})
