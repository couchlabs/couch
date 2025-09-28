import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"

import { APIException } from "@/api/errors"
import { logger } from "@/lib/logger"

// Route imports
import healthRoutes from "@/api/routes/health"
import subscriptionRoutes from "@/api/routes/subscriptions"

import type { WorkerEnv } from "@/types/api.env"

const api = new Hono<{ Bindings: WorkerEnv }>().basePath("/api")
api.use(cors())

// Error handler middleware
api.onError((error, ctx) => {
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

// Mount routes
api.route("/health", healthRoutes)
api.route("/subscriptions", subscriptionRoutes)

export default api
