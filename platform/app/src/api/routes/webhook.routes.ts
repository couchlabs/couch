import type { ValidatedJWT } from "@app-api/middleware/cdp-jwt-validate.middleware"
import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import { Hono } from "hono"

const logger = createLogger("app.api.webhook.route")

export const webhookRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: { jwt: ValidatedJWT }
}>()

/**
 * POST /api/webhook
 * Create or update webhook configuration
 */
webhookRoutes.post("/", async (c) => {
  const { cdpUserId } = c.get("jwt")
  const { url } = await c.req.json<{ url?: string }>()

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return c.json({ error: "Invalid URL" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.createWebhook({
      cdpUserId,
      url: url.trim(),
    })
    return c.json(result)
  } catch (error) {
    logger.error("Create webhook error:", error)
    if (error instanceof Error && error.message.includes("Invalid")) {
      return c.json({ error: error.message }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * GET /api/webhook
 * Get webhook configuration
 */
webhookRoutes.get("/", async (c) => {
  const { cdpUserId } = c.get("jwt")

  try {
    const result = await c.env.COUCH_BACKEND_RPC.getWebhook({
      cdpUserId,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Get webhook error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * PATCH /api/webhook/url
 * Update webhook URL only
 */
webhookRoutes.patch("/url", async (c) => {
  const { cdpUserId } = c.get("jwt")
  const { url } = await c.req.json<{ url?: string }>()

  if (!url || typeof url !== "string" || url.trim().length === 0) {
    return c.json({ error: "Invalid URL" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.updateWebhookUrl({
      cdpUserId,
      url: url.trim(),
    })
    return c.json(result)
  } catch (error) {
    logger.error("Update webhook URL error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Webhook not found" }, 404)
    }
    if (error instanceof Error && error.message.includes("Invalid")) {
      return c.json({ error: error.message }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * POST /api/webhook/rotate
 * Rotate webhook secret only
 */
webhookRoutes.post("/rotate", async (c) => {
  const { cdpUserId } = c.get("jwt")

  try {
    const result = await c.env.COUCH_BACKEND_RPC.rotateWebhookSecret({
      cdpUserId,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Rotate webhook secret error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Webhook not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * DELETE /api/webhook
 * Delete webhook
 */
webhookRoutes.delete("/", async (c) => {
  const { cdpUserId } = c.get("jwt")

  try {
    const result = await c.env.COUCH_BACKEND_RPC.deleteWebhook({
      cdpUserId,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Delete webhook error:", error)
    if (error instanceof Error && error.message.includes("not found")) {
      return c.json({ error: "Webhook not found" }, 404)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})
