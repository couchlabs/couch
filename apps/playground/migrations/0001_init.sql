-- Initial schema for demo app
-- Minimal tables to track subscriptions and webhook events

-- Subscriptions table (minimal - only backend response data)
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,              -- subscription hash
  status TEXT NOT NULL,             -- 'processing', 'active', 'failed'
  transaction_hash TEXT,            -- from activation response
  period_in_seconds INTEGER,        -- billing period (from first webhook order)
  amount TEXT,                      -- charge amount (from first webhook order)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Webhook events table
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'subscription.updated',
  event_data TEXT NOT NULL,        -- JSON blob of full webhook payload
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- Index for faster event queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_subscription_id ON webhook_events(subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at DESC);