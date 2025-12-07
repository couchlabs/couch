/**
 * Merchant Worker - Secure RPC Proxy
 *
 * Acts as a same-origin proxy for internal RPC calls to the backend.
 * Provides minimal API surface and enforces security by WAF Rulest (defined in alchemy.run).
 */

import { Hono } from "hono"
import { isAddress } from "viem"
import type { WorkerEnv } from "../../types/env.d.ts"

const app = new Hono<{ Bindings: WorkerEnv }>()

// Account sync endpoint
app.post("/api/account", async (c) => {
  const { address } = await c.req.json<{ address?: string }>()

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.getOrCreateAccount({
      address,
    })
    return c.json(result)
  } catch (error) {
    console.error("Account sync error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

// 404 for everything else
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404)
})

export default app
