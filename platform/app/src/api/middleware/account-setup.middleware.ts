import type { VerifiedAuth } from "@app/api/middleware/cdp-auth.middleware"
import type { ApiWorkerEnv } from "@app-types/api.env"
import type { MiddlewareHandler } from "hono"
import type { Address } from "viem"

/**
 * Account setup middleware
 * Validates that the authenticated user has completed account setup
 * Adds the user's account address to context for route handlers
 */
export function requireAccountSetup(): MiddlewareHandler<{
  Bindings: ApiWorkerEnv
  Variables: { auth: VerifiedAuth; accountAddress: Address }
}> {
  return async function accountSetupHandler(c, next) {
    const { cdpUserId } = c.get("auth")

    // Look up account by CDP user ID
    const account = await c.env.COUCH_BACKEND_RPC.getAccountByCdpUserId({
      cdpUserId,
    })

    if (!account) {
      return c.json({ error: "Account setup required" }, 403)
    }

    // Add account address to context for handlers to use
    c.set("accountAddress", account.address)
    return next()
  }
}
