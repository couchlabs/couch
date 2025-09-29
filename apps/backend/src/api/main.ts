import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"

import { ErrorCode } from "@/api/errors"
import { logger } from "@/lib/logger"

// Route imports
import healthRoutes from "@/api/routes/health"
import subscriptionRoutes from "@/api/routes/subscriptions"

import type { WorkerEnv } from "@/types/api.env"

const api = new Hono<{ Bindings: WorkerEnv }>().basePath("/api")
api.use(cors())

// Error handler middleware
api.onError((error, ctx) => {
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
api.route("/health", healthRoutes)
api.route("/subscriptions", subscriptionRoutes)

export default api
