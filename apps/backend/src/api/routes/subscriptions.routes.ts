import { Hono } from "hono"
import { type AuthContext, apiKeyAuth } from "@/api/middleware/auth.middleware"
import { isTestnetEnvironment } from "@/constants/env.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { OnchainRepository } from "@/repositories/onchain.repository"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { SubscriptionService } from "@/services/subscription.service"

import type { WorkerEnv } from "@/types/api.env"

export const subscriptionRoutes = new Hono<{
  Bindings: WorkerEnv
  Variables: { auth: AuthContext }
}>()

// Require auth for all routes
subscriptionRoutes.use(apiKeyAuth())

/**
 * POST /api/subscriptions
 * Creates and activates a subscription with initial charge
 */
subscriptionRoutes.post("/", async (ctx) => {
  const { accountAddress } = ctx.get("auth")

  const { subscription_id } = await ctx.req.json().catch(() => ({}))
  if (!subscription_id) {
    throw new HTTPError(
      400,
      ErrorCode.MISSING_FIELD,
      "subscription_id is required",
    )
  }

  const subscriptionService = new SubscriptionService({
    subscriptionRepository: new SubscriptionRepository({ db: ctx.env.DB }),
    onchainRepository: new OnchainRepository({
      cdp: {
        apiKeyId: ctx.env.CDP_API_KEY_ID,
        apiKeySecret: ctx.env.CDP_API_KEY_SECRET,
        walletSecret: ctx.env.CDP_WALLET_SECRET,
        walletName: ctx.env.CDP_WALLET_NAME,
        paymasterUrl: ctx.env.CDP_PAYMASTER_URL,
        smartAccountAddress: ctx.env.CDP_SMART_ACCOUNT_ADDRESS,
      },
      testnet: isTestnetEnvironment(ctx.env.STAGE),
    }),
  })

  // Activate the subscription (validates and process first charge) and link to merchant account
  const result = await subscriptionService.activate({
    subscriptionId: subscription_id,
    accountAddress,
  })

  // Complete database operations in the background
  ctx.executionCtx.waitUntil(subscriptionService.completeActivation(result))

  // Return as soon as the first charge succeeds
  return new Response(
    JSON.stringify({
      data: {
        subscription_id: result.subscriptionId,
        transaction_hash: result.transaction.hash,
        next_order_date: result.nextOrder.date,
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
