import { Hono } from "hono"
import { type AuthContext, apiKeyAuth } from "@/api/middleware/auth.middleware"
import {
  type SubscriptionBodyContext,
  type SubscriptionParamContext,
  subscriptionBody,
  subscriptionParam,
} from "@/api/middleware/subscription.middleware"
import { SubscriptionService } from "@/services/subscription.service"
import { WebhookService } from "@/services/webhook.service"
import type { ApiWorkerEnv } from "@/types/api.env"

export const subscriptionRoutes = new Hono<{
  Bindings: ApiWorkerEnv
  Variables: {
    auth: AuthContext
    subscription: SubscriptionBodyContext | SubscriptionParamContext
  }
}>()

// Require auth for all routes
subscriptionRoutes.use(apiKeyAuth())

/**
 * POST /v1/subscriptions
 * Creates and activates a subscription with initial charge
 * Returns the activated subscription details containing first onchain trnsaction
 */
subscriptionRoutes.post("/", subscriptionBody(), async (ctx) => {
  const { account } = ctx.get("auth")
  const { subscriptionId, provider, testnet, beneficiary } =
    ctx.get("subscription")

  // Beneficiary defaults to account address if not specified
  const beneficiaryAddress = beneficiary || account.address

  const subscriptionService = new SubscriptionService(ctx.env)
  const webhookService = new WebhookService(ctx.env)

  // Create subscription in DB and start background activation
  const { orderId, orderNumber, subscriptionMetadata } =
    await subscriptionService.createSubscription({
      subscriptionId,
      accountId: account.id,
      beneficiaryAddress,
      provider,
      testnet,
    })

  // Process activation charge and emit webhooks in background
  ctx.executionCtx.waitUntil(
    (async () => {
      try {
        // 1. Fire created webhook FIRST
        await webhookService.emitSubscriptionCreated({
          accountId: account.id,
          subscriptionId,
          amount: subscriptionMetadata.amount,
          periodInSeconds: subscriptionMetadata.periodInSeconds,
          testnet,
        })

        // 2. Attempt activation charge
        const activation = await subscriptionService.processActivationCharge({
          subscriptionId,
          accountId: account.id,
          beneficiaryAddress,
          provider,
          testnet,
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
          accountId: account.id,
          subscriptionId,
          amount: subscriptionMetadata.amount,
          periodInSeconds: subscriptionMetadata.periodInSeconds,
          testnet,
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

/**
 * DELETE /v1/subscriptions/:id
 * Revokes a subscription on-chain and updates database
 * Returns the canceled subscription object (idempotent)
 */
subscriptionRoutes.delete("/:id", subscriptionParam(), async (ctx) => {
  const { account } = ctx.get("auth")
  const { subscriptionId } = ctx.get("subscription")

  const subscriptionService = new SubscriptionService(ctx.env)

  const canceledSubscription = await subscriptionService.revokeSubscription({
    subscriptionId,
    accountId: account.id,
  })

  return ctx.json(canceledSubscription, 200)
})
