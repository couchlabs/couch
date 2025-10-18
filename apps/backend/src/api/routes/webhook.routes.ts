import { Hono } from "hono"
import { type AuthContext, apiKeyAuth } from "@/api/middleware/auth.middleware"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { WebhookService } from "@/services/webhook.service"
import type { WorkerEnv } from "@/types/api.env"

export const webhookRoutes = new Hono<{
  Bindings: WorkerEnv
  Variables: { auth: AuthContext }
}>()

// Require auth for all routes
webhookRoutes.use(apiKeyAuth())

/**
 * PUT /api/webhook
 * Sets or updates the webhook URL for the authenticated account
 * Returns the webhook secret for HMAC verification
 */
webhookRoutes.put("/", async (c) => {
  const { accountAddress } = c.get("auth")

  const body = await c.req.json<{ url?: string }>()
  const url = body.url

  if (!url) {
    throw new HTTPError(400, ErrorCode.INVALID_REQUEST, "url is required")
  }

  const webhookService = new WebhookService(c.env)
  const webhook = await webhookService.setWebhook({
    creatorAddress: accountAddress,
    url,
  })

  return c.json({
    secret: webhook.secret,
  })
})
