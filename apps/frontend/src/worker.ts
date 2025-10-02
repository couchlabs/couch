import { Hono } from "hono"
import { cors } from "hono/cors"
import { proxy } from "hono/proxy"
import type { WorkerEnv } from "../types/env"

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
  return c.text("", 200)
})

// Simple catch-all proxy that inject X-API-Key headers with COUCH_API_KEY
app.all("/proxy/*", async (c) => {
  const url = c.env.COUCH_API_URL.replace(/\/+$/, "")
  const path = c.req.path.replace(/^\/proxy\//, "")
  const clientIp =
    c.req.header("CF-Connecting-IP") ||
    c.req.header("X-Forwarded-For") ||
    c.req.header("X-Real-IP") ||
    "127.0.0.1"

  return proxy(`${url}/${path}`, {
    ...c.req,
    headers: {
      ...c.req.header(),
      "X-Forwarded-For": clientIp,
      "X-Forwarded-Host": c.req.header("host"),
      "X-API-Key": c.env.COUCH_API_KEY,
      Authorization: undefined,
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
      status: "active" | "inactive" | "processing"
      current_period_end?: number // Unix timestamp
    }
    order?: {
      number: number
      type: "setup" | "recurring"
      amount: string
      status: "paid" | "failed"
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
