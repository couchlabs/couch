import { Hono } from "hono"
import { type AuthContext, apiKeyAuth } from "@/api/middleware/auth.middleware"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { WebhookRepository } from "@/repositories/webhook.repository"
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
 */
webhookRoutes.put("/", async (c) => {
  const { accountAddress } = c.get("auth")

  const body = await c.req.json<{ url?: string }>()

  if (!body.url) {
    throw new HTTPError(400, ErrorCode.INVALID_REQUEST, "url is required")
  }

  const webhookService = new WebhookService({
    webhookRepository: new WebhookRepository({
      db: c.env.DB,
    }),
  })

  // Set or update webhook
  const result = await webhookService.setWebhook({
    accountAddress,
    url: body.url,
  })

  // Return the webhook secret for HMAC verification
  return c.json({
    secret: result.secret,
  })
})
