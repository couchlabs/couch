import { Hono } from "hono"

import type { ApiWorkerEnv } from "@/types/api.env"

export const healthRoutes = new Hono<{ Bindings: ApiWorkerEnv }>()

/**
 * GET /v1/health
 * Returns the health status of the API
 */
healthRoutes.get("/", (ctx) => {
  return ctx.json({ status: "healthy", timestamp: new Date().toISOString() })
})
