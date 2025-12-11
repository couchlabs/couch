import type { ValidatedJWT } from "@app-api/middleware/cdp-jwt-validate.middleware"
import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import { Provider } from "@backend/providers/provider.interface"
import { Hono } from "hono"
import { isHash } from "viem"

const logger = createLogger("app.api.subscriptions.route")

export const subscriptionsRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: { jwt: ValidatedJWT }
}>()

/**
 * GET /api/subscriptions?testnet=true
 * List all subscriptions for authenticated user
 */
subscriptionsRoutes.get("/", async (c) => {
  const { cdpUserId } = c.get("jwt")
  const testnetParam = c.req.query("testnet")

  try {
    const result = await c.env.COUCH_BACKEND_RPC.listSubscriptions({
      cdpUserId,
      testnet: testnetParam === "true",
    })
    return c.json({ subscriptions: result })
  } catch (error) {
    logger.error("List subscriptions error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * POST /api/subscriptions
 * Create a new subscription
 */
subscriptionsRoutes.post("/", async (c) => {
  const { cdpUserId } = c.get("jwt")
  const {
    subscriptionId,
    provider,
    testnet = false,
  } = await c.req.json<{
    subscriptionId?: string
    provider?: string
    testnet?: boolean
  }>()

  // Validate inputs
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
      cdpUserId,
      subscriptionId: subscriptionId,
      provider: provider as Provider,
      testnet,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Create subscription error:", error)
    if (error instanceof Error && error.message.includes("already exists")) {
      return c.json({ error: "Subscription already registered" }, 400)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * GET /api/subscriptions/:id
 * Get subscription details with orders
 */
subscriptionsRoutes.get("/:id", async (c) => {
  const { cdpUserId } = c.get("jwt")
  const subscriptionId = c.req.param("id")

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return c.json({ error: "Invalid subscription ID" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.getSubscription({
      cdpUserId,
      subscriptionId: subscriptionId as `0x${string}`,
    })

    if (!result) {
      return c.json({ error: "Subscription not found" }, 404)
    }

    return c.json(result)
  } catch (error) {
    logger.error("Get subscription error:", error)
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return c.json({ error: "Unauthorized" }, 403)
    }
    return c.json({ error: "Internal error" }, 500)
  }
})

/**
 * POST /api/subscriptions/:id/revoke
 * Revoke a subscription
 */
subscriptionsRoutes.post("/:id/revoke", async (c) => {
  const { cdpUserId } = c.get("jwt")
  const subscriptionId = c.req.param("id")

  if (!subscriptionId || typeof subscriptionId !== "string") {
    return c.json({ error: "Invalid subscription ID" }, 400)
  }

  try {
    const result = await c.env.COUCH_BACKEND_RPC.revokeSubscription({
      cdpUserId,
      subscriptionId: subscriptionId as `0x${string}`,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Revoke subscription error:", error)
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
