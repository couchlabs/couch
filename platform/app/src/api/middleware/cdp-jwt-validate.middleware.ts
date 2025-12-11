import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import type { MiddlewareHandler } from "hono"
import { bearerAuth } from "hono/bearer-auth"

const logger = createLogger("app.api.cdp-jwt-validate.middleware")

/**
 * Validated JWT data (doesn't require account to exist)
 * Used for account setup endpoint where user doesn't have an account yet
 */
export interface ValidatedJWT {
  cdpUserId: string
}

/**
 * JWT validation middleware
 * Validates Bearer token and extracts cdpUserId
 * Does NOT require account to exist (use this for account setup)
 */
export function validateJWT(): MiddlewareHandler<{
  Bindings: ApiWorkerEnv
  Variables: { jwt: ValidatedJWT }
}> {
  return bearerAuth({
    verifyToken: async (jwt, c) => {
      try {
        // Call RPC to validate JWT and get cdpUserId (no account lookup)
        const { cdpUserId } = await c.env.COUCH_BACKEND_RPC.cdpJWTValidate({
          jwt,
        })

        // Store only cdpUserId in context (account doesn't exist yet)
        c.set("jwt", { cdpUserId })

        return true
      } catch (error) {
        logger.error("JWT validation failed", error)
        return false
      }
    },
  })
}
