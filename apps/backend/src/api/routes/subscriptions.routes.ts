import { Hono } from "hono"
import { type AuthContext, apiKeyAuth } from "@/api/middleware/auth.middleware"
import {
  type SubscriptionContext,
  subscriptionBody,
} from "@/api/middleware/subscription.middleware"
import { SubscriptionService } from "@/services/subscription.service"
import { WebhookService } from "@/services/webhook.service"
import type { WorkerEnv } from "@/types/api.env"

export const subscriptionRoutes = new Hono<{
  Bindings: WorkerEnv
  Variables: { auth: AuthContext; subscription: SubscriptionContext }
}>()

// Require auth for all routes
subscriptionRoutes.use(apiKeyAuth())

/**
 * POST /api/subscriptions
 * Creates and activates a subscription with initial charge
 * Returns the activated subscription details containing first onchain trnsaction
 */
subscriptionRoutes.post("/", subscriptionBody(), async (ctx) => {
  const { accountAddress } = ctx.get("auth")
  const { subscriptionId, providerId } = ctx.get("subscription")

  const subscriptionService = new SubscriptionService()

  // Activate the subscription (validates and process first charge) and link to merchant account
  const activation = await subscriptionService.activate({
    subscriptionId,
    accountAddress,
    providerId,
  })

  // Complete database operations and emit webhook in the background
  ctx.executionCtx.waitUntil(
    (async () => {
      // Complete activation
      await subscriptionService.completeActivation(activation)

      // Emit webhook event
      const webhookService = new WebhookService()
      await webhookService.emitSubscriptionActivated(activation)
    })(),
  )

  return new Response(
    JSON.stringify({
      data: {
        subscription_id: activation.subscriptionId,
        transaction_hash: activation.transaction.hash,
        next_order_date: activation.nextOrder.date,
      },
    }),
    {
      status: 202,
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
})
