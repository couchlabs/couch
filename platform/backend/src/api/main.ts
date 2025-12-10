// Main API entry point for Couch subscription service

import { healthRoutes } from "@backend/api/routes/health.routes"
import { subscriptionRoutes } from "@backend/api/routes/subscriptions.routes"
import { webhookRoutes } from "@backend/api/routes/webhook.routes"
import { ErrorCode } from "@backend/errors/http.errors"
import { logger } from "@backend/lib/logger"
import type { ApiWorkerEnv } from "@backend-types/api.env"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"

const app = new Hono<{ Bindings: ApiWorkerEnv }>().basePath("/v1")

// CORS middleware
app.use(cors())

// Error handler middleware
app.onError((error, ctx) => {
  logger.error("Request error", {
    path: ctx.req.path,
    method: ctx.req.method,
    message: error.message,
    stack: error.stack,
  })

  // Return HTTPException response (HTTPError extends HTTPException)
  if (error instanceof HTTPException) {
    return error.getResponse()
  }

  // Handle unexpected errors
  return ctx.json(
    {
      error: "Internal server error",
      code: ErrorCode.INTERNAL_ERROR,
    },
    500,
  )
})

// Mount routes
app.route("/health", healthRoutes)
app.route("/webhook", webhookRoutes)
app.route("/subscriptions", subscriptionRoutes)

export default app

// Export the OrderScheduler DO class so it's available in this worker
export { OrderScheduler } from "@backend/schedulers/order.scheduler"
