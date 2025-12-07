import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { D1Database } from "@cloudflare/workers-types"
import { createTestDB } from "@tests/test-db"
import { Hono } from "hono"
import { getAddress } from "viem"
import { keysRoutes } from "@/api/routes/keys.routes"
import { AccountService } from "@/services/account.service"
import type { WorkerEnv } from "@/types/api.env"

describe("PUT /v1/keys", () => {
  let dispose: (() => Promise<void>) | undefined
  let testDB: {
    db: D1Database
    orderIds: number[]
    dispose: () => Promise<void>
  }
  let env: Partial<WorkerEnv>
  let app: Hono<{ Bindings: WorkerEnv }>
  let accountService: AccountService
  let initialApiKey: string
  let testAccountId: number

  const TEST_ACCOUNT = getAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1")

  beforeEach(async () => {
    // Create test database
    testDB = await createTestDB({
      accounts: [],
    })
    dispose = testDB.dispose

    // Create mock environment
    env = {
      DB: testDB.db,
      LOGGING: "verbose",
      // biome-ignore lint/suspicious/noExplicitAny: Test mock
    } as any as Partial<WorkerEnv>

    // Create test app with keys routes
    app = new Hono<{ Bindings: WorkerEnv }>()
    app.route("/", keysRoutes)

    // Create account
    accountService = new AccountService(env as WorkerEnv)
    await accountService.createAccount({
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
    testAccountId = account.id

    // Generate initial API key via rotation
    const { apiKey } = await accountService.rotateApiKey(testAccountId)
    initialApiKey = apiKey
  })

  afterEach(async () => {
    if (dispose) {
      await dispose()
    }
    mock.clearAllMocks()
  })

  it("rotates API key successfully when authenticated", async () => {
    const res = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${initialApiKey}`,
        },
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(200)

    const json = await res.json<{ api_key: string }>()
    expect(json.api_key).toBeDefined()
    expect(json.api_key).toMatch(/^ck_[a-f0-9]{32}$/)

    // New key should be different from initial key
    expect(json.api_key).not.toBe(initialApiKey)
  })

  it("returns 401 when no authorization header", async () => {
    const res = await app.request(
      "/",
      {
        method: "PUT",
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(401)

    const json = await res.json<{ error: string; code: string }>()
    expect(json.code).toBe("UNAUTHORIZED")
  })

  it("returns 401 when authorization header is malformed", async () => {
    const res = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: "InvalidFormat",
        },
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(401)

    const json = await res.json<{ error: string; code: string }>()
    // Malformed auth header is treated as invalid API key
    expect(json.code).toBe("INVALID_API_KEY")
  })

  it("returns 401 when API key is invalid", async () => {
    const res = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: "Bearer ck_testnet_invalid",
        },
      },
      env as WorkerEnv,
    )

    expect(res.status).toBe(401)

    const json = await res.json<{ error: string; code: string }>()
    expect(json.code).toBe("INVALID_API_KEY")
  })

  it("invalidates old API key after rotation", async () => {
    // Rotate the key
    const rotateRes = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${initialApiKey}`,
        },
      },
      env as WorkerEnv,
    )

    expect(rotateRes.status).toBe(200)

    // Try to use old key - should fail
    const oldKeyRes = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${initialApiKey}`,
        },
      },
      env as WorkerEnv,
    )

    expect(oldKeyRes.status).toBe(401)

    const json = await oldKeyRes.json<{ error: string; code: string }>()
    expect(json.code).toBe("INVALID_API_KEY")
  })

  it("new API key works for authentication", async () => {
    // Rotate the key
    const rotateRes = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${initialApiKey}`,
        },
      },
      env as WorkerEnv,
    )

    expect(rotateRes.status).toBe(200)
    const rotateJson = await rotateRes.json<{ api_key: string }>()
    const newApiKey = rotateJson.api_key

    // Use new key for another rotation - should succeed
    const newKeyRes = await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${newApiKey}`,
        },
      },
      env as WorkerEnv,
    )

    expect(newKeyRes.status).toBe(200)

    const newKeyJson = await newKeyRes.json<{ api_key: string }>()
    expect(newKeyJson.api_key).toBeDefined()
    expect(newKeyJson.api_key).not.toBe(newApiKey)
  })

  it("generates different keys on multiple rotations", async () => {
    const keys = new Set<string>([initialApiKey])
    let currentKey = initialApiKey

    // Rotate 5 times
    for (let i = 0; i < 5; i++) {
      const res = await app.request(
        "/",
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${currentKey}`,
          },
        },
        env as WorkerEnv,
      )

      expect(res.status).toBe(200)

      const json = await res.json<{ api_key: string }>()
      keys.add(json.api_key)
      currentKey = json.api_key
    }

    // All keys should be unique (initial + 5 rotations = 6 total)
    expect(keys.size).toBe(6)
  })

  it("only one key exists per account after rotation", async () => {
    // Rotate the key
    await app.request(
      "/",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${initialApiKey}`,
        },
      },
      env as WorkerEnv,
    )

    // Verify only one key exists in database
    const keyCount = await testDB.db
      .prepare("SELECT COUNT(*) as count FROM api_keys WHERE account_id = ?")
      .bind(testAccountId)
      .first<{ count: number }>()

    expect(keyCount?.count).toBe(1)
  })
})
