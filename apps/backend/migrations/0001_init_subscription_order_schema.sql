-- Migration: Create schema for subscription order system
-- Description: Core tables for managing subscriptions, orders, and transactions

-- =============================================================================
-- SUBSCRIPTION SYSTEM TABLES
-- =============================================================================

-- Core subscription state (minimal - onchain is source of truth)
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,  -- This IS the permission hash from onchain
  status TEXT NOT NULL CHECK(status IN ('processing', 'active', 'incomplete', 'past_due', 'canceled', 'unpaid')),
  owner_address TEXT NOT NULL,  -- Couch's smart wallet address (the spender)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders (individual charges for subscriptions)
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('initial', 'recurring', 'retry')),
  due_at DATETIME NOT NULL,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'paid', 'failed', 'pending_retry')),
  attempts INTEGER DEFAULT 0,
  parent_order_id INTEGER,  -- Links retry orders to original failed order
  next_retry_at DATETIME,  -- For retry orders: when to attempt next retry
  failure_reason TEXT,  -- Mapped error code: 'INSUFFICIENT_SPENDING_ALLOWANCE', 'PERMISSION_EXPIRED', etc.
  raw_error TEXT,  -- Original error message from the blockchain/service for debugging
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Transaction log (actual onchain transactions)
CREATE TABLE IF NOT EXISTS transactions (
  transaction_hash TEXT NOT NULL,  -- Can be shared when SDK batches multiple orders
  order_id INTEGER PRIMARY KEY,  -- Unique per order
  subscription_id TEXT NOT NULL,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed')),  -- Only successful transactions are recorded
  gas_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- -----------------------------------------------------------------------------
-- Indexes for Subscription System
-- -----------------------------------------------------------------------------

-- Time-based queries
CREATE INDEX idx_subscriptions_created ON subscriptions(created_at);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_transactions_created ON transactions(created_at);

-- Scheduler and processing
CREATE INDEX idx_orders_due_status ON orders(due_at, status);

-- Foreign key relationships
CREATE INDEX idx_orders_subscription ON orders(subscription_id);
CREATE INDEX idx_transactions_subscription ON transactions(subscription_id);
CREATE INDEX idx_transactions_order ON transactions(order_id);
CREATE INDEX idx_transactions_hash ON transactions(transaction_hash);  -- For looking up all orders in a batch
CREATE INDEX idx_orders_parent ON orders(parent_order_id);

-- Status filtering
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_transactions_status ON transactions(status);

-- Dunning scheduler (for retry orders)
CREATE INDEX idx_orders_retry_due ON orders(next_retry_at, status) WHERE next_retry_at IS NOT NULL;

-- Account lookup
CREATE INDEX idx_subscriptions_owner ON subscriptions(owner_address);

-- =============================================================================
-- ACCOUNT SYSTEM TABLES
-- =============================================================================

-- Accounts table (tied to merchant wallet address)
CREATE TABLE IF NOT EXISTS accounts (
    address TEXT PRIMARY KEY  -- Checksummed address (0x...)
);

-- API Keys table (V1: one key per account, V2: multiple)
CREATE TABLE IF NOT EXISTS api_keys (
    key_hash TEXT PRIMARY KEY,          -- SHA-256 hash of the secret part (no prefix)
    account_address TEXT NOT NULL REFERENCES accounts(address) ON DELETE CASCADE
);

-- Single webhook per account
CREATE TABLE IF NOT EXISTS webhooks (
    account_address TEXT PRIMARY KEY REFERENCES accounts(address) ON DELETE CASCADE,
    url TEXT NOT NULL,                  -- HTTPS URL
    secret TEXT NOT NULL                -- For HMAC signature verification
);

-- Link subscriptions to accounts (merchant who receives payments)
ALTER TABLE subscriptions ADD COLUMN account_address TEXT REFERENCES accounts(address);

-- Add order sequence tracking for webhook events
ALTER TABLE orders ADD COLUMN order_number INTEGER;

-- Add provider support for multi-provider subscriptions
ALTER TABLE subscriptions ADD COLUMN provider_id TEXT NOT NULL CHECK(provider_id IN ('base'));

-- Add period tracking to orders (each order is for a specific billing period)
-- period_length_in_seconds: Duration of the billing period for this order
-- period_start = due_at
-- period_end = due_at + period_length_in_seconds
ALTER TABLE orders ADD COLUMN period_length_in_seconds INTEGER;

-- -----------------------------------------------------------------------------
-- Indexes for Account System
-- -----------------------------------------------------------------------------

CREATE INDEX idx_api_keys_account ON api_keys(account_address);
CREATE INDEX idx_subscriptions_account ON subscriptions(account_address);
CREATE INDEX idx_orders_subscription_number ON orders(subscription_id, order_number);