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
 * CDP authentication middleware
 * Validates Bearer token and authenticates user via RPC
 * Adds verified user info with account to context
 */
export function cdpAuth(): MiddlewareHandler<{
  Bindings: ApiWorkerEnv
  Variables: { auth: VerifiedAuth }
}> {
  return bearerAuth({
    verifyToken: async (jwt, c) => {
      try {
        // Call RPC to authenticate user (validates JWT + looks up account)
        const auth = await c.env.COUCH_BACKEND_RPC.cdpAuthenticate({ jwt })

        // Store verified auth data in context
        c.set("auth", auth)

        return true
      } catch (error) {
        logger.error("JWT validation failed", error)
        return false
      }
    },
  })
}
