import type { ValidatedJWT } from "@app-api/middleware/cdp-jwt-validate.middleware"
import type { ApiWorkerEnv } from "@app-types/api.env"
import { createLogger } from "@backend/lib/logger"
import { Hono } from "hono"

const logger = createLogger("app.api.balances.route")

export const balancesRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: { jwt: ValidatedJWT }
}>()

/**
 * GET /api/balances/:network/:address
 * Fetches token balances via backend RPC (uses CDP SDK)
 * Requires authentication via CDP JWT
 */
balancesRoutes.get("/:network/:address", async (c) => {
  const network = c.req.param("network") as "base" | "base-sepolia"
  const address = c.req.param("address")

  try {
    logger.info("Fetching token balances", { network, address })

    // Call backend RPC which uses CDP SDK
    const result = await c.env.COUCH_BACKEND_RPC.getTokenBalances({
      network,
      address,
    })

    return c.json(result)
  } catch (error) {
    logger.error("Token balances fetch error:", error)
    return c.json(
      {
        error: "Failed to fetch token balances",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
})
