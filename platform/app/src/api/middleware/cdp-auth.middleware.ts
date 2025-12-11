import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import type { MiddlewareHandler } from "hono"
import { bearerAuth } from "hono/bearer-auth"
import type { Address } from "viem"

const logger = createLogger("app.api.cdp-auth.middleware")

/**
 * Verified auth data from CDP JWT validation
 */
export interface VerifiedAuth {
  cdpUserId: string
  accountAddress: Address
}

/**
 * CDP JWT authentication middleware
 * Validates Bearer token by calling validateJWT via RPC
 * Adds verified user info to context
 */
export function cdpAuth(): MiddlewareHandler<{
  Bindings: ApiWorkerEnv
  Variables: { auth: VerifiedAuth }
}> {
  return bearerAuth({
    verifyToken: async (jwt, c) => {
      try {
        // Call RPC to validate JWT
        const auth = await c.env.COUCH_BACKEND_RPC.validateJWT({ jwt })

        // Store verified auth data in context
        c.set("auth", auth)

        return true
      } catch (error) {
        logger.error("JWT validation failed", { error })
        return false
      }
    },
  })
}
