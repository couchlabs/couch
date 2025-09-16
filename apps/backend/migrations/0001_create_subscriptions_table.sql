-- Migration: Create subscriptions table
-- Description: Initial schema for subscription management POC

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,    -- On-chain subscription ID (also workflow ID)
  status TEXT NOT NULL,                -- On-chain status: active, revoked
  billing_status TEXT NOT NULL,        -- Billing status: pending, active, failed
  owner_address TEXT NOT NULL,         -- Address that receives payments
  payer_address TEXT NOT NULL,         -- Address that pays
  recurring_charge TEXT NOT NULL,      -- Amount in USD (e.g., "9.99")
  period_days INTEGER NOT NULL,        -- Billing period in days (from on-chain)
  next_charge_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for finding subscriptions that need charging
CREATE INDEX idx_subscriptions_next_charge
  ON subscriptions(next_charge_at, billing_status)
  WHERE billing_status = 'active';

-- Index for quick lookup by status
CREATE INDEX idx_subscriptions_status
  ON subscriptions(status, billing_status);