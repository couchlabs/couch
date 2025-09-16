import { Hono } from "hono"

import { CloudflareEnv } from "../types/env"

const app = new Hono<{ Bindings: CloudflareEnv }>()

app.post("/api/subscriptions", async (c) => {
  const body = await c.req.json()
  // Validate mandatory subscription_id

  // Endpoint logic here
  // bindings avail c.env.HERE
  return c.text(`Hello Subscription ID: ${body.subscription_id}`)
})

export default app
