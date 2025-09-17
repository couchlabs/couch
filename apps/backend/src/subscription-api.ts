import { Hono } from "hono"
import { cors } from "hono/cors"

import { WorkerEnv } from "../types/api.env"

export * from "./subscription-billing"
export * from "./subscription-setup"

const app = new Hono<{ Bindings: WorkerEnv }>()

app.use(cors())

app.post("/api/subscriptions", async (c) => {
  try {
    // TODO: Consider API Key for protecting against abuses
    const body = await c.req.json().catch(() => null)
    const subscriptionId = body?.subscription_id

    // Validate mandatory subscription_id
    if (!subscriptionId) {
      return c.json({ error: "subscription_id is required" }, 400)
    }

    // 2. Check if subscription already exists in database
    // TODO: add validation on hash format
    const existingSubscription = await c.env.SUBSCRIPTIONS.prepare(
      "SELECT * FROM subscriptions WHERE subscription_id = ?",
    )
      .bind(subscriptionId)
      .first()

    if (existingSubscription) {
      return c.json(
        {
          error: "Subscription already exists",
          subscription: existingSubscription,
        },
        409,
      )
    }

    // Start setup workflow
    await c.env.SUBSCRIPTION_SETUP.create({
      id: `setup-${subscriptionId}`,
      params: { subscriptionId },
    })

    return c.json(
      {
        message: "Subscription setup initiated",
        subscription_id: subscriptionId,
        status: "processing",
      },
      202,
    )
  } catch (error) {
    console.error("Error creating subscription:", error)
    return c.json({ error: "Failed to create subscription" }, 500)
  }
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
