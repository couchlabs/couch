/**
 * Merchant Worker - Secure RPC Proxy
 *
 * Acts as a same-origin proxy for internal RPC calls to the backend.
 * Provides minimal API surface and enforces security by WAF Rulest (defined in alchemy.run).
 */

import { Hono } from "hono"
import { isAddress, isHash } from "viem"
import { Provider } from "@/providers/provider.interface"
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

// POST /api/webhook - Create/update webhook
app.post("/api/webhook", async (c) => {
  const { address, url } = await c.req.json<{
    address?: string
    url?: string
  }>()

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return c.json({ error: "Invalid URL" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.createWebhook({
      accountAddress: address,
      url: url.trim(),
    })
    return c.json(result)
  } catch (error) {
    console.error("Create webhook error:", error)
    if (error instanceof Error && error.message.includes("Invalid")) {
      return c.json({ error: error.message }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// GET /api/webhook?address=0x... - Get webhook configuration
app.get("/api/webhook", async (c) => {
  const address = c.req.query("address")

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.getWebhook({
      accountAddress: address,
    })
    return c.json(result)
  } catch (error) {
    console.error("Get webhook error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

// PATCH /api/webhook/url - Update webhook URL only
app.patch("/api/webhook/url", async (c) => {
  const { address, url } = await c.req.json<{
    address?: string
    url?: string
  }>()

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return c.json({ error: "Invalid URL" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.updateWebhookUrl({
      accountAddress: address,
      url: url.trim(),
    })
    return c.json(result)
  } catch (error) {
    console.error("Update webhook URL error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Webhook not found" }, 404)
    }
    if (error instanceof Error && error.message.includes("Invalid")) {
      return c.json({ error: error.message }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// POST /api/webhook/rotate - Rotate webhook secret only
app.post("/api/webhook/rotate", async (c) => {
  const { address } = await c.req.json<{ address?: string }>()

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.rotateWebhookSecret({
      accountAddress: address,
    })
    return c.json(result)
  } catch (error) {
    console.error("Rotate webhook secret error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Webhook not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// DELETE /api/webhook?address=0x... - Delete webhook
app.delete("/api/webhook", async (c) => {
  const address = c.req.query("address")

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.deleteWebhook({
      accountAddress: address,
    })
    return c.json(result)
  } catch (error) {
    console.error("Delete webhook error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Webhook not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// GET /api/subscriptions?address=0x...&testnet=true - List subscriptions
app.get("/api/subscriptions", async (c) => {
  const address = c.req.query("address")
  const testnetParam = c.req.query("testnet")

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  // Parse testnet as optional boolean
  const testnet =
    testnetParam === "true"
      ? true
      : testnetParam === "false"
        ? false
        : undefined

  try {
    const result = await c.env.COUCH_BACKEND_RPC.listSubscriptions({
      accountAddress: address,
      testnet,
    })
    return c.json({ subscriptions: result })
  } catch (error) {
    console.error("List subscriptions error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

// POST /api/subscriptions - Create subscription
app.post("/api/subscriptions", async (c) => {
  const {
    address,
    subscriptionId,
    provider,
    testnet = false,
  } = await c.req.json<{
    address?: string
    subscriptionId?: string
    provider?: string
    testnet?: boolean
  }>()

  // Validate inputs
  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  if (!subscriptionId || !isHash(subscriptionId)) {
    return c.json({ error: "Invalid subscription ID" }, 400)
  }

  if (!provider || !Object.values(Provider).includes(provider as Provider)) {
    return c.json({ error: "Invalid provider" }, 400)
  }

  if (typeof testnet !== "boolean") {
    return c.json({ error: "Invalid testnet flag" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.createSubscription({
      accountAddress: address as `0x${string}`,
      subscriptionId: subscriptionId as `0x${string}`,
      provider: provider as Provider,
      testnet,
    })
    return c.json(result)
  } catch (error) {
    console.error("Create subscription error:", error)
    if (error instanceof Error && error.message.includes("already exists")) {
      return c.json({ error: "Subscription already registered" }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// GET /api/subscriptions/:id?address=0x... - Get subscription details with orders
app.get("/api/subscriptions/:id", async (c) => {
  const subscriptionId = c.req.param("id")
  const address = c.req.query("address")

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return c.json({ error: "Invalid subscription ID" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.getSubscription({
      accountAddress: address,
      subscriptionId: subscriptionId as `0x${string}`,
    })

    if (!result) {
      return c.json({ error: "Subscription not found" }, 404)
    }

    return c.json(result)
  } catch (error) {
    console.error("Get subscription error:", error)
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return c.json({ error: "Unauthorized" }, 403)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// POST /api/subscriptions/:id/revoke?address=0x... - Revoke subscription
app.post("/api/subscriptions/:id/revoke", async (c) => {
  const subscriptionId = c.req.param("id")
  const address = c.req.query("address")

  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return c.json({ error: "Invalid subscription ID" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.revokeSubscription({
      accountAddress: address,
      subscriptionId: subscriptionId as `0x${string}`,
    })
    return c.json(result)
  } catch (error) {
    console.error("Revoke subscription error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Subscription not found" }, 404)
    }
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return c.json({ error: "Unauthorized" }, 403)
    }
    if (error instanceof Error && error.message.includes("cannot be revoked")) {
      return c.json({ error: error.message }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

// 404 for everything else
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404)
})

export default app
