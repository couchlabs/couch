-- Migration: Create subscriptions table
-- Description: Initial schema for subscription management POC

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,    -- On-chain subscription ID (also workflow ID)
  is_subscribed BOOLEAN NOT NULL,      -- Current on-chain subscription status
  billing_status TEXT NOT NULL,        -- Billing status: pending, active, failed
  recurring_charge TEXT NOT NULL,      -- Amount in USD (e.g., "9.99")
  period_days INTEGER,                 -- Billing period in days (nullable if not provided)
  next_charge_at DATETIME,              -- Next scheduled charge time
  last_charge_at DATETIME,              -- Last successful charge time
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for finding subscriptions that need charging
CREATE INDEX idx_subscriptions_next_charge
  ON subscriptions(next_charge_at, billing_status)
  WHERE billing_status = 'active';

-- Index for quick lookup by status
CREATE INDEX idx_subscriptions_status
  ON subscriptions(is_subscribed, billing_status);
