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
  const { subscriptionId, provider, beneficiary } = ctx.get("subscription")

  // Beneficiary defaults to accountAddress if not specified (self-subscription)
  const beneficiaryAddress = beneficiary || accountAddress

  const subscriptionService = new SubscriptionService(ctx.env)
  const webhookService = new WebhookService(ctx.env)

  // Create subscription in DB and start background activation
  const { orderId, orderNumber, subscriptionMetadata } =
    await subscriptionService.createSubscription({
      subscriptionId,
      accountAddress,
      beneficiaryAddress,
      provider,
    })

  // Process activation charge and emit webhooks in background
  ctx.executionCtx.waitUntil(
    (async () => {
      try {
        // 1. Fire created webhook FIRST
        await webhookService.emitSubscriptionCreated({
          accountAddress,
          subscriptionId,
          amount: subscriptionMetadata.amount,
          periodInSeconds: subscriptionMetadata.periodInSeconds,
        })

        // 2. Attempt activation charge
        const activation = await subscriptionService.processActivationCharge({
          subscriptionId,
          accountAddress,
          beneficiaryAddress,
          provider,
          orderId,
          orderNumber,
        })

        // 3. Complete activation in DB
        await subscriptionService.completeActivation(activation)

        // 4. Fire activation success webhook
        await webhookService.emitSubscriptionActivated(activation)
      } catch (error) {
        // 5. Mark subscription as incomplete in DB
        const errorMessage =
          error instanceof Error ? error.message : "activation_failed"
        await subscriptionService.markSubscriptionIncomplete({
          subscriptionId,
          orderId,
          reason: errorMessage,
        })

        // 6. Fire activation failed webhook (service handles error sanitization)
        await webhookService.emitActivationFailed({
          accountAddress,
          subscriptionId,
          amount: subscriptionMetadata.amount,
          periodInSeconds: subscriptionMetadata.periodInSeconds,
          error,
        })
      }
    })(),
  )

  // Return immediately with processing status
  return new Response(
    JSON.stringify({
      status: "processing",
    }),
    {
      status: 201,
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
})
