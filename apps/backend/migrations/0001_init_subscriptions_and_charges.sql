-- Migration: Create minimal schema for subscription management
-- Description: Subscription state tracking and charge history for subscription POC

-- Table for tracking workflow state only
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,
  billing_status TEXT NOT NULL CHECK(billing_status IN ('pending', 'active', 'failed', 'cancelled')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table for tracking all charge attempts
CREATE TABLE IF NOT EXISTS charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  transaction_hash TEXT,
  charged_by TEXT,
  recipient TEXT,
  error_message TEXT,
  charged_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Indexes for performance
CREATE UNIQUE INDEX idx_charges_tx_hash ON charges(transaction_hash) WHERE transaction_hash IS NOT NULL;
CREATE INDEX idx_charges_subscription ON charges(subscription_id);
CREATE INDEX idx_charges_success ON charges(success);
CREATE INDEX idx_charges_date ON charges(charged_at);
