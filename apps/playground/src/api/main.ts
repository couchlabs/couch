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

// Helper function to handle proxy requests
async function handleProxy(c: any) {
  const path = c.req.path.replace(/^\/proxy\//, "")
  const clientIp =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    c.req.header("X-Real-IP") ||
    "127.0.0.1"

  // API endpoints: append path to base URL
  const baseUrl = c.env.COUCH_API_URL?.replace(/\/+$/, "") || ""
  const targetUrl = `${baseUrl}/${path}`

  console.log("Proxy request debug:", {
    COUCH_API_URL: c.env.COUCH_API_URL,
    COUCH_API_KEY: c.env.COUCH_API_KEY ? "SET" : "NOT SET",
    path: path,
    baseUrl: baseUrl,
    targetUrl: targetUrl,
    method: c.req.method,
  })

  // Check if env vars are properly set
  if (!c.env.COUCH_API_URL) {
    return c.json({ error: "COUCH_API_URL not configured" }, 500)
  }
  if (!c.env.COUCH_API_KEY) {
    return c.json({ error: "COUCH_API_KEY not configured" }, 500)
  }

  try {
    // Try using fetch instead of proxy to test
    const requestHeaders = c.req.header()
    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers: {
        ...requestHeaders,
        "X-Forwarded-For": clientIp,
        "X-Forwarded-Host": c.req.header("host") || "",
        Authorization: `Bearer ${c.env.COUCH_API_KEY}`,
      },
      body:
        c.req.method !== "GET" && c.req.method !== "HEAD"
          ? await c.req.text()
          : undefined,
    })

    const responseBody = await response.text()
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })
    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error("Proxy error:", error)
    return c.json(
      {
        error: "Proxy failed",
        details: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}

// Test simple async route without DO
app.get("/test-async", async (c) => {
  await new Promise((resolve) => setTimeout(resolve, 10))
  return c.json({ message: "Async works!" })
})

// Test env variables
app.get("/test-env", (c) => {
  return c.json({
    COUCH_API_URL: c.env.COUCH_API_URL ? "SET" : "NOT SET",
    COUCH_API_KEY: c.env.COUCH_API_KEY ? "SET" : "NOT SET",
    COUCH_WEBHOOK_SECRET: c.env.COUCH_WEBHOOK_SECRET ? "SET" : "NOT SET",
    STORE: c.env.STORE ? "SET" : "NOT SET",
  })
})

// Proxy endpoint - using single-segment route since nested paths don't work
app.post("/backend-subscriptions", async (c) => {
  console.log("POST /backend-subscriptions called!")

  // Return early with env check
  if (!c.env.COUCH_API_URL || !c.env.COUCH_API_KEY) {
    return c.json(
      {
        error: "Environment variables not configured",
        COUCH_API_URL: c.env.COUCH_API_URL ? "SET" : "NOT SET",
        COUCH_API_KEY: c.env.COUCH_API_KEY ? "SET" : "NOT SET",
      },
      500,
    )
  }

  // Construct backend URL
  const baseUrl = c.env.COUCH_API_URL.replace(/\/+$/, "")
  const targetUrl = `${baseUrl}/api/subscriptions`

  console.log("Proxying to backend:", targetUrl)

  try {
    const body = await c.req.text()
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.env.COUCH_API_KEY}`,
      },
      body: body,
    })

    const responseBody = await response.text()
    console.log("Backend response status:", response.status)

    return new Response(responseBody, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    console.error("Proxy error:", error)
    return c.json({ error: "Proxy failed", details: String(error) }, 500)
  }
})

// Also add GET endpoint for health check testing
app.get("/backend-health", async (c) => {
  if (!c.env.COUCH_API_URL) {
    return c.json({ error: "COUCH_API_URL not configured" }, 500)
  }

  const targetUrl = `${c.env.COUCH_API_URL.replace(/\/+$/, "")}/api/health`

  try {
    const response = await fetch(targetUrl)
    const data = await response.text()
    return new Response(data, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return c.json({ error: "Health check failed", details: String(error) }, 500)
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
