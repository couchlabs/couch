import { Hono } from "hono"

import { CloudflareEnv } from "../types/env"

export * from "./subscription-billing"

const app = new Hono<{ Bindings: CloudflareEnv }>()

app.post("/api/subscriptions", async (c) => {
  const body = await c.req.json()
  // Validate mandatory subscription_id

  // Endpoint logic here
  // bindings avail c.env.HERE
  return c.text(`Hello Subscription ID: ${body.subscription_id}`)
})

// Test endpoint to list all subscriptions (for debugging)
app.get("/api/subscriptions", async (c) => {
  try {
    const { results } = await c.env.SUBSCRIPTIONS.prepare(
      "SELECT * FROM subscriptions ORDER BY created_at DESC",
    ).all()

    return c.json({
      count: results.length,
      subscriptions: results,
    })
  } catch (error) {
    return c.json({ error: "Failed to fetch subscriptions" }, 500)
  }
})

export default app
