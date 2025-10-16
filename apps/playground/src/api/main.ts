import { Hono } from "hono"
import { cors } from "hono/cors"
import type { WorkerEnv } from "../../types/env"

export { Store } from "../store/do.store"
export const app = new Hono<{ Bindings: WorkerEnv }>()

app.use(cors())

app.onError((err, c) => {
  console.error("Error:", err.message)

  switch (err.message) {
    case "Missing signature":
    case "Invalid signature":
      return c.json({ error: err.message }, 401)
    case "Webhook secret not configured":
      return c.json({ error: err.message }, 500)
    case "Invalid JSON payload":
      return c.json({ error: err.message }, 400)
    default:
      return c.json({ error: "Internal server error" }, 500)
  }
})

// Get all subscriptions
app.get("/api/subscriptions", async (c) => {
  const store = c.env.STORE.get(c.env.STORE.idFromName("global"))
  const subscriptions = await store.getSubscriptions()
  return c.json(subscriptions)
})

// Get single subscription
app.get("/api/subscriptions/:id", async (c) => {
  const id = c.req.param("id")
  const store = c.env.STORE.get(c.env.STORE.idFromName("global"))
  const subscription = await store.getSubscription(id)

  if (!subscription) {
    return c.json({ error: "Subscription not found" }, 404)
  }

  return c.json(subscription)
})

// Get webhook events for a subscription
app.get("/api/subscriptions/:id/events", async (c) => {
  const id = c.req.param("id")
  const store = c.env.STORE.get(c.env.STORE.idFromName("global"))
  const events = await store.getWebhookEvents(id)
  return c.json(events)
})

app.post("/api/webhook", async (c) => {
  const body = await c.req.text()
  const signature = c.req.header("X-Webhook-Signature")

  // Construct and validate the webhook event (Stripe-style)
  const event = await constructWebhookEvent(
    body,
    signature,
    c.env.COUCH_WEBHOOK_SECRET,
  )

  // Process the event
  if (event.type !== "subscription.updated") {
    console.log("Unknown event type:", event.type)
  }
  console.log(JSON.stringify(event, null, 2))

  // Save to Durable Object store
  const subscriptionId = event.data.subscription.id
  const status = event.data.subscription.status
  const amount = event.data.subscription.amount
  const periodInSeconds = event.data.subscription.period_in_seconds

  const store = c.env.STORE.get(c.env.STORE.idFromName("global"))

  // Upsert subscription
  await store.upsertSubscription({
    id: subscriptionId,
    status,
    transaction_hash: event.data.transaction?.hash,
    amount,
    period_in_seconds: periodInSeconds,
  })

  // Insert webhook event
  await store.addWebhookEvent({
    subscription_id: subscriptionId,
    event_type: event.type,
    event_data: body,
  })

  return c.text("", 200)
})

// Test simple async route without DO
app.get("/test-async", async (c) => {
  await new Promise((resolve) => setTimeout(resolve, 10))
  return c.json({ message: "Async works!" })
})

// Test env variables
app.get("/test-env", (c) => {
  return c.json({
    BACKEND_API: c.env.BACKEND_API ? "SET" : "NOT SET",
    COUCH_API_URL: c.env.COUCH_API_URL ? "SET" : "NOT SET",
    COUCH_API_KEY: c.env.COUCH_API_KEY ? "SET" : "NOT SET",
    COUCH_WEBHOOK_SECRET: c.env.COUCH_WEBHOOK_SECRET ? "SET" : "NOT SET",
    STORE: c.env.STORE ? "SET" : "NOT SET",
  })
})

// RPC-style backend API call using service binding
app.post("/activate", async (c) => {
  console.log("POST /activate called - using service binding!")

  if (!c.env.BACKEND_API) {
    return c.json({ error: "Backend API binding not configured" }, 500)
  }

  try {
    const body = await c.req.text()

    // Use service binding for RPC-style call
    const response = await c.env.BACKEND_API.fetch(
      "https://backend/api/subscriptions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.COUCH_API_KEY}`,
        },
        body: body,
      },
    )
    const responseBody = await response.text()

    console.log("Backend response status:", response.status)

    return new Response(responseBody, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Service binding error:", error)
    return c.json(
      { error: "Service binding failed", details: String(error) },
      500,
    )
  }
})

export default app

/**
 * Constructs and validates a webhook event from the request
 * Similar to Stripe's constructEventAsync pattern
 */

interface WebhookEvent {
  type: "subscription.updated"
  created_at: number // Unix timestamp
  data: {
    subscription: {
      id: string // subscription ID (hash)
      status:
        | "processing"
        | "active"
        | "incomplete"
        | "past_due"
        | "canceled"
        | "unpaid"
      amount: string // Recurring charge amount (always present)
      period_in_seconds: number // Billing period (always present)
    }
    order?: {
      number: number
      type: "initial" | "recurring"
      amount: string
      status: "paid" | "failed"
      current_period_start?: number
      current_period_end?: number
    }
    transaction?: {
      hash: string
      amount: string
      processed_at: number
    }
    error?: {
      code: string
      message: string
    }
  }
}

async function constructWebhookEvent(
  body: string,
  signature: string | undefined,
  secret: string | undefined,
): Promise<WebhookEvent> {
  if (!secret) {
    throw new Error("Webhook secret not configured")
  }

  if (!signature) {
    throw new Error("Missing signature")
  }

  // Extract signature from header format "sha256=<signature>"
  const providedSignature = signature.replace("sha256=", "")

  // Generate expected signature
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  const expectedSignatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body),
  )

  // Convert to hex string
  const expectedSignature = Array.from(new Uint8Array(expectedSignatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  // Verify signature
  if (providedSignature !== expectedSignature) {
    throw new Error("Invalid signature")
  }

  // Parse and return the validated event
  try {
    return JSON.parse(body) as WebhookEvent
  } catch {
    throw new Error("Invalid JSON payload")
  }
}
