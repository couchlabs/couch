import { Hono } from "hono"
import { cors } from "hono/cors"
import { proxy } from "hono/proxy"
import type { WorkerEnv } from "../../types/env"

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
  const result = await c.env.DB.prepare(
    "SELECT * FROM subscriptions ORDER BY created_at DESC",
  ).all()
  return c.json(result.results || [])
})

// Get single subscription
app.get("/api/subscriptions/:id", async (c) => {
  const id = c.req.param("id")
  const result = await c.env.DB.prepare(
    "SELECT * FROM subscriptions WHERE id = ?",
  )
    .bind(id)
    .first()

  if (!result) {
    return c.json({ error: "Subscription not found" }, 404)
  }
  return c.json(result)
})

// Get webhook events for a subscription
app.get("/api/subscriptions/:id/events", async (c) => {
  const id = c.req.param("id")
  const result = await c.env.DB.prepare(
    "SELECT * FROM webhook_events WHERE subscription_id = ? ORDER BY created_at DESC",
  )
    .bind(id)
    .all()
  return c.json(result.results || [])
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

  // Save to database
  const subscriptionId = event.data.subscription.id
  const status = event.data.subscription.status
  const amount = event.data.subscription.amount
  const periodInSeconds = event.data.subscription.period_in_seconds

  // Upsert subscription
  // Only set transaction_hash, amount, and period_in_seconds on INSERT (initial order), never update them
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (id, status, transaction_hash, amount, period_in_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       updated_at = datetime('now')`,
  )
    .bind(
      subscriptionId,
      status,
      event.data.transaction?.hash || null,
      amount,
      periodInSeconds,
    )
    .run()

  // Insert webhook event
  await c.env.DB.prepare(
    `INSERT INTO webhook_events (subscription_id, event_type, event_data, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  )
    .bind(subscriptionId, event.type, body)
    .run()

  return c.text("", 200)
})

// Simple catch-all proxy that injects Authorization: Bearer header with COUCH_API_KEY
app.all("/proxy/*", async (c) => {
  const path = c.req.path.replace(/^\/proxy\//, "")
  const clientIp =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    c.req.header("X-Real-IP") ||
    "127.0.0.1"

  // Special case: __scheduled endpoint is on port 3100 (order-processor)
  let baseUrl = c.env.COUCH_API_URL.replace(/\/+$/, "")
  if (path === "__scheduled") {
    baseUrl = baseUrl.replace(":3000", ":3100")
  }

  return proxy(`${baseUrl}/${path}`, {
    ...c.req,
    headers: {
      ...c.req.header(),
      "X-Forwarded-For": clientIp,
      "X-Forwarded-Host": c.req.header("host"),
      Authorization: `Bearer ${c.env.COUCH_API_KEY}`,
    },
  })
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
