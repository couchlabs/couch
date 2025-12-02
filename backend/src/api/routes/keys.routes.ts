import { Hono } from "hono"
import { apiKeyAuth } from "@/api/middleware/auth.middleware"
import { AccountService } from "@/services/account.service"
import type { WorkerEnv } from "@/types/api.env"

export const keysRoutes = new Hono<{ Bindings: WorkerEnv }>()

/**
 * PUT /api/keys
 * Rotates the API key for the authenticated account
 * Returns the new API key (previous key is immediately invalidated)
 */
keysRoutes.put("/", apiKeyAuth(), async (c) => {
  const { account } = c.get("auth")
  const accountService = new AccountService(c.env)

  const result = await accountService.rotateApiKey(account.id)

  return c.json({
    api_key: result.apiKey,
  })
})
