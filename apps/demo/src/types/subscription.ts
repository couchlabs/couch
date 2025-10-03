export interface Subscription {
  id: string
  status: "processing" | "active" | "inactive"
  transaction_hash: string | null
  period_in_seconds: number | null
  amount: string | null
  created_at: string
  updated_at: string
}

export interface WebhookEvent {
  id: number
  subscription_id: string
  event_type: string
  event_data: string
  created_at: string
}

export interface WebhookEventData {
  type: string
  created_at: number
  data: {
    subscription: {
      id: string
      status: "active" | "inactive" | "processing"
      amount: string // Always present - immutable subscription terms
      period_in_seconds: number // Always present - immutable subscription terms
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
