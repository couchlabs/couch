-- Migration: Create schema for subscription billing system
-- Description: Core tables for managing subscriptions, billing entries, and transactions

-- Core subscription state (minimal - onchain is source of truth)
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,  -- This IS the permission hash from onchain
  status TEXT NOT NULL CHECK(status IN ('processing', 'active', 'inactive')),
  account_address TEXT NOT NULL,  -- User's wallet address
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Billing schedule and state (drives all charging logic)
CREATE TABLE IF NOT EXISTS billing_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('recurring', 'retry')),
  due_at DATETIME NOT NULL,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  parent_billing_id INTEGER,  -- Links retry entries to original failed entry
  failure_reason TEXT,  -- 'insufficient_funds', 'permission_expired', 'network_error', etc.
  processing_lock DATETIME,
  locked_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Transaction log (actual onchain transactions)
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_entry_id INTEGER NOT NULL,
  subscription_id TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'failed')),
  failure_reason TEXT,
  gas_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (billing_entry_id) REFERENCES billing_entries(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Indexes for performance
-- Time-based queries
CREATE INDEX idx_subscriptions_created ON subscriptions(created_at);
CREATE INDEX idx_billing_created ON billing_entries(created_at);
CREATE INDEX idx_transactions_created ON transactions(created_at);

-- Scheduler and processing
CREATE INDEX idx_billing_due_status ON billing_entries(due_at, status);
CREATE INDEX idx_billing_processing ON billing_entries(processing_lock, status);

-- Foreign key relationships
CREATE INDEX idx_billing_subscription ON billing_entries(subscription_id);
CREATE INDEX idx_transactions_subscription ON transactions(subscription_id);
CREATE INDEX idx_transactions_billing_entry ON transactions(billing_entry_id);

-- Status filtering
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_billing_status ON billing_entries(status);
CREATE INDEX idx_transactions_status ON transactions(status);

-- Account lookup
CREATE INDEX idx_subscriptions_account ON subscriptions(account_address);