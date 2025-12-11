import {
  cdpAuth,
  type VerifiedAuth,
} from "@app/api/middleware/cdp-auth.middleware"
import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import { Hono } from "hono"

const logger = createLogger("app.api.keys.route")

export const keysRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: { auth: VerifiedAuth }
}>()

// Require full auth (account must exist)
keysRoutes.use(cdpAuth())

/**
 * POST /api/keys
 * Create a new API key
 */
keysRoutes.post("/", async (c) => {
  const { accountAddress } = c.get("auth")
  const { name } = await c.req.json<{ name?: string }>()

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return c.json({ error: "Invalid name" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.createApiKey({
      accountAddress,
      name: name.trim(),
    })
    return c.json(result)
  } catch (error) {
    logger.error("Create API key error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * GET /api/keys
 * List all API keys for authenticated user
 */
keysRoutes.get("/", async (c) => {
  const { accountAddress } = c.get("auth")

  try {
    const result = await c.env.COUCH_BACKEND_RPC.listApiKeys({ accountAddress })
    return c.json({ keys: result })
  } catch (error) {
    logger.error("List API keys error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * PATCH /api/keys/:id
 * Update an API key (name or enabled status)
 */
keysRoutes.patch("/:id", async (c) => {
  const { accountAddress } = c.get("auth")
  const keyId = parseInt(c.req.param("id"), 10)
  const { name, enabled } = await c.req.json<{
    name?: string
    enabled?: boolean
  }>()

  if (Number.isNaN(keyId) || keyId <= 0) {
    return c.json({ error: "Invalid key ID" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.updateApiKey({
      accountAddress,
      keyId,
      name: name?.trim(),
      enabled,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Update API key error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "API key not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * DELETE /api/keys/:id
 * Delete an API key
 */
keysRoutes.delete("/:id", async (c) => {
  const { accountAddress } = c.get("auth")
  const keyId = parseInt(c.req.param("id"), 10)

  if (Number.isNaN(keyId) || keyId <= 0) {
    return c.json({ error: "Invalid key ID" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.deleteApiKey({
      accountAddress,
      keyId,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Delete API key error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "API key not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})
