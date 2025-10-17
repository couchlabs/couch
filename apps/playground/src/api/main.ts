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
    c.env.TEST_COUCH_ACCOUNT_WEBHOOK_SECRET,
  )

  // Process the event
  if (event.type !== "subscription.updated") {
    // Unknown event type - might add more event types in the future
  }

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

// WebSocket endpoint for real-time updates
app.get("/ws", async (c) => {
  // Get the Durable Object stub
  const store = c.env.STORE.get(c.env.STORE.idFromName("global"))

  // Forward the WebSocket upgrade request to the DO
  const response = await store.fetch(c.req.url, {
    headers: c.req.raw.headers,
  })

  // Return the Cloudflare Response directly (includes webSocket property)
  return response
})

// Health check endpoint - useful for monitoring service binding
app.get("/test-binding", async (c) => {
  if (!c.env.BACKEND_API) {
    return c.json({ error: "Backend API binding not configured" }, 500)
  }

  try {
    const response = await c.env.BACKEND_API.fetch("https://backend/api/health")
    const data = await response.json()
    return c.json({
      success: true,
      backend_status: response.status,
      backend_data: data,
    })
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

// RPC-style backend API call using service binding
app.post("/activate", async (c) => {
  if (!c.env.BACKEND_API) {
    return c.json({ error: "Backend API binding not configured" }, 500)
  }

  try {
    const body = await c.req.text()

    // Use service binding for RPC-style call
    const headers = new Headers(c.req.header())
    headers.set("Authorization", `Bearer ${c.env.TEST_COUCH_ACCOUNT_APIKEY}`)

    const response = await c.env.BACKEND_API.fetch(
      "https://backend/api/subscriptions",
      {
        method: "POST",
        headers: headers,
        body: body,
      },
    )
    const responseBody = await response.text()

    return new Response(responseBody, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Service binding error:", error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return c.json(
      { error: "Service binding failed", message: errorMessage },
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
