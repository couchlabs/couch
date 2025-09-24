import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { WorkerEnv } from "../types/api.env"
import { SubscriptionService } from "./services/subscription.service"
import { APIException, APIErrors } from "./subscription-api.errors"
import { logger } from "./lib/logger"

const app = new Hono<{ Bindings: WorkerEnv }>()
app.use(cors())

// Error handler middleware
app.onError((error, ctx) => {
  if (error instanceof HTTPException) {
    if (error instanceof APIException) {
      logger.error(`API Error: ${error.code}`, error)
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
  if (!subscription_id || typeof subscription_id !== "string") {
    throw APIErrors.invalidRequest("subscription_id is required")
  }

  const service = await SubscriptionService.getInstance()

  // Activate the subscription (validates and charges)
  const { subscription, context } = await service.activateSubscription({
    subscriptionId: subscription_id,
  })

  // Complete database operations in the background
  ctx.executionCtx.waitUntil(service.completeSubscriptionSetup(context))

  // Return as soon as the first charge succeeds
  return new Response(JSON.stringify({ data: subscription }), {
    status: 202,
    headers: {
      "Content-Type": "application/json",
    },
  })
})

app.get("/health", (ctx) => {
  return ctx.json({ status: "healthy", timestamp: new Date().toISOString() })
})

export default app
