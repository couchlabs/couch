import { Hono } from "hono"

import type { WorkerEnv } from "@/types/api.env"

export const healthRoutes = new Hono<{ Bindings: WorkerEnv }>()

/**
 * GET /api/health
 * Returns the health status of the API
 */
healthRoutes.get("/", (ctx) => {
  return ctx.json({ status: "healthy", timestamp: new Date().toISOString() })
})
