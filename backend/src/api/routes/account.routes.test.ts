import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { D1Database } from "@cloudflare/workers-types"
import { createTestDB } from "@tests/test-db"
import { Hono } from "hono"
import { getAddress } from "viem"
import { accountRoutes } from "@/api/routes/account.routes"
import type { WorkerEnv } from "@/types/api.env"

describe("POST /api/account", () => {
  let dispose: (() => Promise<void>) | undefined
  let testDB: {
    db: D1Database
    orderIds: number[]
    dispose: () => Promise<void>
  }
  let mockAllowlist: {
    get: ReturnType<typeof mock>
  }
  let env: Partial<WorkerEnv>
  let app: Hono<{ Bindings: WorkerEnv }>

  const TEST_ACCOUNT = getAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1")
  const TEST_ACCOUNT_NOT_ALLOWED = getAddress(
    "0x1234567890123456789012345678901234567890",
  )

  beforeEach(async () => {
    // Create test database
    testDB = await createTestDB({
      accounts: [],
    })
    dispose = testDB.dispose

    // Create mock ALLOWLIST KV namespace
    mockAllowlist = {
      get: mock(),
    }

    // Default behavior: TEST_ACCOUNT is allowlisted, others are not
    mockAllowlist.get.mockImplementation(async (key: string) => {
      if (key.toLowerCase() === TEST_ACCOUNT.toLowerCase()) {
        return "2025-01-01T00:00:00.000Z"
      }
      return null
    })

    // Create mock environment
    env = {
      DB: testDB.db,
      LOGGING: "verbose",
      NETWORK: "testnet",
      ALLOWLIST: mockAllowlist,
      // biome-ignore lint/suspicious/noExplicitAny: Test mock
    } as any as Partial<WorkerEnv>

    // Create test app with account routes
    app = new Hono<{ Bindings: WorkerEnv }>()
    app.route("/", accountRoutes)
  })

  afterEach(async () => {
    if (dispose) {
      await dispose()
    }
    mock.clearAllMocks()
  })

  it("creates account successfully with valid allowlisted address", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: TEST_ACCOUNT,
        }),
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(201)

    const json = await res.json<{
      api_key: string
      subscription_owner: string
    }>()
    expect(json.api_key).toBeDefined()
    expect(json.api_key).toMatch(/^ck_testnet_[a-f0-9]{32}$/)
    expect(json.subscription_owner).toBeDefined()
    expect(json.subscription_owner).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // Verify ALLOWLIST was checked
    expect(mockAllowlist.get).toHaveBeenCalledWith(TEST_ACCOUNT)
  })

  it("returns 403 when address is not allowlisted", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: TEST_ACCOUNT_NOT_ALLOWED,
        }),
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(403)

    const json = await res.json<{ error: string; code: string }>()
    expect(json.code).toBe("ADDRESS_NOT_ALLOWED")
  })

  it("returns 409 when account already exists", async () => {
    // Create account first
    await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: TEST_ACCOUNT,
        }),
      },
      env as WorkerEnv,
    )

    // Try to create again
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: TEST_ACCOUNT,
        }),
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(409)

    const json = await res.json<{ error: string; code: string }>()
    expect(json.code).toBe("ACCOUNT_EXISTS")
  })

  it("returns 400 when address is missing", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(400)

    const json = await res.json<{ error: string; code: string }>()
    expect(json.code).toBe("INVALID_REQUEST")
  })

  it("returns 400 when address format is invalid", async () => {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: "not-a-valid-address",
        }),
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(400)

    const json = await res.json<{ error: string; code: string }>()
    expect(json.code).toBe("INVALID_FORMAT")
  })

  it("normalizes address to checksummed format", async () => {
    // Use lowercase address
    const lowercaseAddress = TEST_ACCOUNT.toLowerCase()

    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: lowercaseAddress,
        }),
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(201)

    // Verify address was stored in checksummed format
    const account = await testDB.db
      .prepare("SELECT address FROM accounts WHERE address = ?")
      .bind(TEST_ACCOUNT)
      .first<{ address: string }>()

    expect(account?.address).toBe(TEST_ACCOUNT)
  })
})
