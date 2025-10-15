import { DurableObject } from "cloudflare:workers"

interface Subscription {
  id: string
  status: string
  transaction_hash?: string
  amount: string
  period_in_seconds: number
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
 */
export class Store extends DurableObject {
  /**
   * Get all subscriptions (ordered by created_at DESC)
   */
  async getSubscriptions(): Promise<Subscription[]> {
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
  }): Promise<void> {
    const existing = await this.getSubscription(data.id)
    const now = new Date().toISOString()

    const subscription: Subscription = {
      id: data.id,
      status: data.status,
      transaction_hash: existing?.transaction_hash || data.transaction_hash,
      amount: existing?.amount || data.amount,
      period_in_seconds: existing?.period_in_seconds || data.period_in_seconds,
      created_at: existing?.created_at || now,
      updated_at: now,
    }

    await this.ctx.storage.put(`subscription:${data.id}`, subscription)
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
  }
}
