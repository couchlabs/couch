import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { D1Database } from "@cloudflare/workers-types"
import { createTestDB } from "@tests/test-db"
import { type Address, getAddress } from "viem"
import type { Network } from "@/constants/env.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
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

    // Create service instance with mocked ALLOWLIST
    service = new AccountService({
      DB: testDB.db,
      LOGGING: "verbose",
      NETWORK,
      ALLOWLIST: mockAllowlist,
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

      // Should return API key
      expect(result.apiKey).toBeDefined()
      expect(result.apiKey).toMatch(/^ck_testnet_[a-f0-9]{32}$/)

      // Verify account was created in database
      const account = await testDB.db
        .prepare("SELECT address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ address: string }>()

      expect(account?.address).toBe(TEST_ACCOUNT)

      // Verify API key was created
      const keyCount = await testDB.db
        .prepare(
          "SELECT COUNT(*) as count FROM api_keys WHERE account_address = ?",
        )
        .bind(TEST_ACCOUNT)
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(1)
    })

    it("throws 403 when address is not allowlisted", async () => {
      await expect(
        service.createAccount({
          address: TEST_ACCOUNT_NOT_ALLOWED,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createAccount({
          address: TEST_ACCOUNT_NOT_ALLOWED,
        })
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
      await expect(
        service.createAccount({
          address: TEST_ACCOUNT,
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createAccount({
          address: TEST_ACCOUNT,
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.ACCOUNT_EXISTS)
        expect((error as HTTPError).status).toBe(409)
      }
    })

    it("throws 400 when address format is invalid", async () => {
      await expect(
        service.createAccount({
          address: "not-a-valid-address",
        }),
      ).rejects.toThrow(HTTPError)

      try {
        await service.createAccount({
          address: "not-a-valid-address",
        })
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_FORMAT)
        expect((error as HTTPError).status).toBe(400)
      }
    })

    it("normalizes address to checksummed format", async () => {
      // Use lowercase address (non-checksummed)
      const lowercaseAddress = TEST_ACCOUNT.toLowerCase()

      await service.createAccount({
        address: lowercaseAddress,
      })

      // Verify address was stored in checksummed format
      const account = await testDB.db
        .prepare("SELECT address FROM accounts WHERE address = ?")
        .bind(TEST_ACCOUNT)
        .first<{ address: string }>()

      expect(account?.address).toBe(TEST_ACCOUNT) // Should be checksummed
    })
  })

  describe("rotateApiKey", () => {
    it("rotates API key successfully for existing account", async () => {
      // Create account first
      const initialResult = await service.createAccount({
        address: TEST_ACCOUNT,
      })
      const initialKey = initialResult.apiKey

      // Rotate the key
      const rotatedResult = await service.rotateApiKey(TEST_ACCOUNT)
      const rotatedKey = rotatedResult.apiKey

      // Keys should be different
      expect(rotatedKey).not.toBe(initialKey)
      expect(rotatedKey).toMatch(/^ck_testnet_[a-f0-9]{32}$/)

      // Verify only one key exists (old one should be deleted)
      const keyCount = await testDB.db
        .prepare(
          "SELECT COUNT(*) as count FROM api_keys WHERE account_address = ?",
        )
        .bind(TEST_ACCOUNT)
        .first<{ count: number }>()

      expect(keyCount?.count).toBe(1)

      // Verify old key no longer works
      await expect(service.authenticateApiKey(initialKey)).rejects.toThrow(
        HTTPError,
      )

      // Verify new key works
      const authenticatedAddress = await service.authenticateApiKey(rotatedKey)
      expect(authenticatedAddress).toBe(TEST_ACCOUNT)
    })

    it("generates different keys on multiple rotations", async () => {
      // Create account
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Rotate multiple times
      const keys = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const result = await service.rotateApiKey(TEST_ACCOUNT)
        keys.add(result.apiKey)
      }

      // All keys should be unique
      expect(keys.size).toBe(5)
    })
  })

  describe("authenticateApiKey", () => {
    it("authenticates valid API key", async () => {
      const { apiKey } = await service.createAccount({
        address: TEST_ACCOUNT,
      })

      const authenticatedAddress = await service.authenticateApiKey(apiKey)

      expect(authenticatedAddress).toBe(TEST_ACCOUNT)
    })

    it("throws 401 when API key is invalid", async () => {
      await expect(
        service.authenticateApiKey("ck_testnet_invalid"),
      ).rejects.toThrow(HTTPError)

      try {
        await service.authenticateApiKey("ck_testnet_invalid")
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError)
        expect((error as HTTPError).code).toBe(ErrorCode.INVALID_API_KEY)
        expect((error as HTTPError).status).toBe(401)
      }
    })

    it("authenticates key after rotation", async () => {
      // Create account
      await service.createAccount({
        address: TEST_ACCOUNT,
      })

      // Rotate key
      const { apiKey: newKey } = await service.rotateApiKey(TEST_ACCOUNT)

      // New key should authenticate
      const authenticatedAddress = await service.authenticateApiKey(newKey)
      expect(authenticatedAddress).toBe(TEST_ACCOUNT)
    })
  })
})
