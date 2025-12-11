import {
  validateJWT,
  type ValidatedJWT,
} from "@app/api/middleware/cdp-jwt-validate.middleware"
import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import { Hono } from "hono"
import { isAddress } from "viem"

const logger = createLogger("app.api.account.route")

export const accountRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: { jwt: ValidatedJWT }
}>()

// Validate JWT only (doesn't require account to exist yet)
accountRoutes.use(validateJWT())

/**
 * PUT /api/account
 * Sets the wallet address for the authenticated user
 * Idempotent - safe to call multiple times with same data
 */
accountRoutes.put("/", async (c) => {
  const { cdpUserId } = c.get("jwt")

  // Get wallet address from request body
  // Frontend provides this via useEvmAddress() - the wallet CDP created for this user
  const { address } = await c.req.json<{ address?: string }>()
  if (!address || !isAddress(address)) {
    return c.json({ error: "Invalid address" }, 400)
  }

  try {
    // PUT semantics: Link CDP user to their wallet address
    // JWT validation ensures request is from authenticated user
    const result = await c.env.COUCH_BACKEND_RPC.getOrCreateAccount({
      address,
      cdpUserId,
    })
    return c.json(result)
  } catch (error) {
    logger.error("Account sync error:", error)
    return c.json({ error: "Internal error" }, 500)
  }
})
