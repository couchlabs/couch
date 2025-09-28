import { Hono } from "hono"

import type { WorkerEnv } from "@/types/api.env"

const health = new Hono<{ Bindings: WorkerEnv }>()

health.get("/", (ctx) => {
  return ctx.json({ status: "healthy", timestamp: new Date().toISOString() })
})

export default health
