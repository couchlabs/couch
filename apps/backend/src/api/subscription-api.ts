import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"

import { APIException, APIErrors } from "@/api/subscription-api.errors"
import { SubscriptionService } from "@/services/subscription.service"
import { SubscriptionRepository } from "@/repositories/subscription.repository"
import { OnchainRepository } from "@/repositories/onchain.repository"
import { isTestnetEnvironment } from "@/lib/constants"
import { logger } from "@/lib/logger"

import type { WorkerEnv } from "@/types/api.env"

const app = new Hono<{ Bindings: WorkerEnv }>()
app.use(cors())

// Error handler middleware
app.onError((error, ctx) => {
  if (error instanceof HTTPException) {
    if (error instanceof APIException) {
      logger.error(`API Error: ${(error as APIException).code}`, error)
    } else {
      logger.error("HTTP Exception", error)
    }
    return error.getResponse()
  }

  logger.error("Unexpected error", error)
  return new Response(
    JSON.stringify({
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    }),
    {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    },
  )
})

app.post("/api/subscriptions", async (ctx) => {
  const { subscription_id } = await ctx.req.json().catch(() => ({}))
  if (!subscription_id) {
    throw APIErrors.invalidRequest("subscription_id is required")
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

  // Activate the subscription (validates and charges)
  const result = await subscriptionService.activate({
    subscriptionId: subscription_id,
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

app.get("/health", (ctx) => {
  return ctx.json({ status: "healthy", timestamp: new Date().toISOString() })
})

export default app
