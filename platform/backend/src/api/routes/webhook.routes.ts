import {
  type AuthContext,
  apiKeyAuth,
} from "@backend/api/middleware/auth.middleware"
import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import { WebhookService } from "@backend/services/webhook.service"
import type { ApiWorkerEnv } from "@backend-types/api.env"
import { Hono } from "hono"

export const webhookRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: { auth: AuthContext }
}>()

// Require auth for all routes
webhookRoutes.use(apiKeyAuth())

/**
 * PUT /v1/webhook
 * Sets or updates the webhook URL for the authenticated account
 * Returns the webhook secret for HMAC verification
 */
webhookRoutes.put("/", async (c) => {
  const { account } = c.get("auth")

  const body = await c.req.json<{ url?: string }>()
  const url = body.url

  if (!url) {
    throw new HTTPError(400, ErrorCode.INVALID_REQUEST, "url is required")
  }

  const webhookService = new WebhookService(c.env)
  const webhook = await webhookService.setWebhook({
    accountId: account.id,
    url,
  })

  return c.json({
    secret: webhook.secret,
  })
})
