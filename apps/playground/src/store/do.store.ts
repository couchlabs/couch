import { DurableObject } from "cloudflare:workers"

interface Subscription {
  id: string
  status: string
  transaction_hash?: string
  amount: string
  period_in_seconds: number
  testnet?: boolean
  created_at: string
  updated_at: string
}

interface WebhookEvent {
  id: number
  subscription_id: string
  event_type: string
  event_data: string
  created_at: string
}

/**
 * Store - Single Durable Object for playground data
 *
 * Stores subscriptions and webhook events in memory.
 * Simple alternative to D1 for demo/testing purposes.
 * Includes WebSocket support for real-time updates.
 */
export class Store extends DurableObject {
  private sessions: Map<WebSocket, { alive: boolean }> = new Map()

  /**
   * Migrate existing subscriptions to add testnet field
   * This runs once per deployment and marks old subscriptions as testnet
   */
  private async migrateSubscriptions(): Promise<void> {
    const migrationKey = "migration:testnet-field"
    const migrated = await this.ctx.storage.get<boolean>(migrationKey)

    if (migrated) {
      return // Already migrated
    }

    // Get all subscriptions
    const subscriptions = await this.ctx.storage.list<Subscription>({
      prefix: "subscription:",
    })

    // Update subscriptions that don't have testnet field
    const updates: Record<string, Subscription> = {}
    for (const [key, sub] of subscriptions) {
      if (sub.testnet === undefined) {
        updates[key] = { ...sub, testnet: true } // Mark old subscriptions as testnet
      }
    }

    // Batch update
    if (Object.keys(updates).length > 0) {
      await this.ctx.storage.put(updates)
    }

    // Mark migration as complete
    await this.ctx.storage.put(migrationKey, true)
  }

  /**
   * Get all subscriptions (ordered by created_at DESC)
   */
  async getSubscriptions(): Promise<Subscription[]> {
    // Run migration before returning subscriptions
    await this.migrateSubscriptions()
    const subscriptions = await this.ctx.storage.list<Subscription>({
      prefix: "subscription:",
    })

    return Array.from(subscriptions.values()).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }

  /**
   * Get single subscription by ID
   */
  async getSubscription(id: string): Promise<Subscription | null> {
    return (
      (await this.ctx.storage.get<Subscription>(`subscription:${id}`)) || null
    )
  }

  /**
   * Upsert subscription
   */
  async upsertSubscription(data: {
    id: string
    status: string
    transaction_hash?: string
    amount: string
    period_in_seconds: number
    testnet?: boolean
  }): Promise<void> {
    const existing = await this.getSubscription(data.id)
    const now = new Date().toISOString()

    // Don't overwrite canceled status
    // This prevents race conditions where a failed charge webhook arrives after cancellation
    const shouldPreserveStatus = existing?.status === "canceled"

    const subscription: Subscription = {
      id: data.id,
      status: shouldPreserveStatus ? existing.status : data.status,
      transaction_hash: existing?.transaction_hash || data.transaction_hash,
      amount: existing?.amount || data.amount,
      period_in_seconds: existing?.period_in_seconds || data.period_in_seconds,
      testnet: existing?.testnet || data.testnet,
      created_at: existing?.created_at || now,
      updated_at: now,
    }

    await this.ctx.storage.put(`subscription:${data.id}`, subscription)

    // Broadcast update to all connected WebSocket clients
    this.broadcast({
      type: "subscription_update",
      data: subscription,
    })
  }

  /**
   * Get webhook events for a subscription (ordered by created_at DESC)
   */
  async getWebhookEvents(subscriptionId: string): Promise<WebhookEvent[]> {
    const events = await this.ctx.storage.list<WebhookEvent>({
      prefix: `event:${subscriptionId}:`,
    })

    return Array.from(events.values()).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }

  /**
   * Add webhook event
   */
  async addWebhookEvent(data: {
    subscription_id: string
    event_type: string
    event_data: string
  }): Promise<void> {
    const now = new Date().toISOString()
    const id = Date.now() // Simple auto-increment using timestamp

    const event: WebhookEvent = {
      id,
      subscription_id: data.subscription_id,
      event_type: data.event_type,
      event_data: data.event_data,
      created_at: now,
    }

    await this.ctx.storage.put(`event:${data.subscription_id}:${id}`, event)

    // Broadcast new event to all connected WebSocket clients
    this.broadcast({
      type: "webhook_event",
      data: event,
    })
  }

  /**
   * Handle incoming HTTP requests (including WebSocket upgrades)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle WebSocket upgrade requests
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request)
    }

    // Handle HTTP API requests
    if (url.pathname === "/subscriptions" && request.method === "GET") {
      const subscriptions = await this.getSubscriptions()
      return new Response(JSON.stringify(subscriptions), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname.startsWith("/subscription/") && request.method === "GET") {
      const id = url.pathname.replace("/subscription/", "")
      const subscription = await this.getSubscription(id)
      if (!subscription) {
        return new Response("Not found", { status: 404 })
      }
      return new Response(JSON.stringify(subscription), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname.startsWith("/events/") && request.method === "GET") {
      const subscriptionId = url.pathname.replace("/events/", "")
      const events = await this.getWebhookEvents(subscriptionId)
      return new Response(JSON.stringify(events), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/subscription" && request.method === "PUT") {
      const data = (await request.json()) as {
        id: string
        status: string
        transaction_hash?: string
        amount: string
        period_in_seconds: number
      }
      await this.upsertSubscription(data)
      return new Response("OK", { status: 200 })
    }

    if (url.pathname === "/event" && request.method === "POST") {
      const data = (await request.json()) as {
        subscription_id: string
        event_type: string
        event_data: string
      }
      await this.addWebhookEvent(data)
      return new Response("OK", { status: 200 })
    }

    return new Response("Not found", { status: 404 })
  }

  /**
   * Handle WebSocket upgrade
   */
  private handleWebSocketUpgrade(_request: Request): Response {
    const [client, server] = Object.values(new WebSocketPair())

    // Accept the WebSocket connection
    server.accept()

    // Track this session
    this.sessions.set(server, { alive: true })

    // Send initial data
    server.send(
      JSON.stringify({
        type: "connected",
        message: "Connected to Store WebSocket",
      }),
    )

    // Handle messages from client
    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        server.send(JSON.stringify({ type: "pong" }))
      }
    })

    // Clean up on close
    server.addEventListener("close", () => {
      this.sessions.delete(server)
    })

    // Handle errors
    server.addEventListener("error", () => {
      this.sessions.delete(server)
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  private broadcast(message: unknown): void {
    const messageString = JSON.stringify(message)

    for (const [ws, session] of this.sessions) {
      if (session.alive) {
        try {
          ws.send(messageString)
        } catch (error) {
          // Remove dead connections
          console.error("Failed to send to WebSocket:", error)
          this.sessions.delete(ws)
        }
      }
    }
  }
}
