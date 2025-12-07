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

// POST /api/keys - Create API key
app.post("/api/keys", async (c) => {
  const { address, name } = await c.req.json<{
    address?: string
    name?: string
  }>()

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return c.json({ error: "Invalid name" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.createApiKey({
      accountAddress: address,
      name: name.trim(),
    })
    return c.json(result)
  } catch (error) {
    console.error("Create API key error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

// GET /api/keys?address=0x... - List API keys
app.get("/api/keys", async (c) => {
  const address = c.req.query("address")

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.listApiKeys({
      accountAddress: address,
    })
    return c.json({ keys: result })
  } catch (error) {
    console.error("List API keys error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

// PATCH /api/keys/:id - Update API key
app.patch("/api/keys/:id", async (c) => {
  const keyId = parseInt(c.req.param("id"), 10)
  const { address, name, enabled } = await c.req.json<{
    address?: string
    name?: string
    enabled?: boolean
  }>()

  if (Number.isNaN(keyId) || keyId <= 0) {
    return c.json({ error: "Invalid key ID" }, 400)
  }

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.updateApiKey({
      accountAddress: address,
      keyId,
      name: name?.trim(),
      enabled,
    })
    return c.json(result)
  } catch (error) {
    console.error("Update API key error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "API key not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// DELETE /api/keys/:id?address=0x... - Delete API key
app.delete("/api/keys/:id", async (c) => {
  const keyId = parseInt(c.req.param("id"), 10)
  const address = c.req.query("address")

  if (Number.isNaN(keyId) || keyId <= 0) {
    return c.json({ error: "Invalid key ID" }, 400)
  }

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.deleteApiKey({
      accountAddress: address,
      keyId,
    })
    return c.json(result)
  } catch (error) {
    console.error("Delete API key error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "API key not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// 404 for everything else
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404)
})

export default app
