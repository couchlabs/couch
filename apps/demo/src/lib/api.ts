import type { Subscription, WebhookEvent } from "@/types/subscription"

export async function getSubscriptions(): Promise<Subscription[]> {
  const response = await fetch("/api/subscriptions")
  if (!response.ok) {
    throw new Error("Failed to fetch subscriptions")
  }
  return response.json()
}

export async function getSubscription(id: string): Promise<Subscription> {
  const response = await fetch(`/api/subscriptions/${id}`)
  if (!response.ok) {
    throw new Error("Failed to fetch subscription")
  }
  return response.json()
}

export async function getSubscriptionEvents(
  id: string,
): Promise<WebhookEvent[]> {
  const response = await fetch(`/api/subscriptions/${id}/events`)
  if (!response.ok) {
    throw new Error("Failed to fetch subscription events")
  }
  return response.json()
}
