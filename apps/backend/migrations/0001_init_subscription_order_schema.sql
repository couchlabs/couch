-- Migration: Create schema for subscription order system
-- Description: Core tables for managing subscriptions, orders, and transactions

-- Core subscription state (minimal - onchain is source of truth)
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,  -- This IS the permission hash from onchain
  status TEXT NOT NULL CHECK(status IN ('processing', 'active', 'inactive')),
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
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'paid', 'failed')),
  attempts INTEGER DEFAULT 0,
  parent_order_id INTEGER,  -- Links retry orders to original failed order
  failure_reason TEXT,  -- Mapped error code: 'INSUFFICIENT_SPENDING_ALLOWANCE', 'PERMISSION_EXPIRED', etc.
  raw_error TEXT,  -- Original error message from the blockchain/service for debugging
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Transaction log (actual onchain transactions)
CREATE TABLE IF NOT EXISTS transactions (
  transaction_hash TEXT PRIMARY KEY,  -- Use blockchain transaction hash as PK
  order_id INTEGER NOT NULL,
  subscription_id TEXT NOT NULL,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed')),  -- Only successful transactions are recorded
  gas_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Indexes for performance
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
CREATE INDEX idx_orders_parent ON orders(parent_order_id);

-- Status filtering
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_transactions_status ON transactions(status);

-- Account lookup
CREATE INDEX idx_subscriptions_owner ON subscriptions(owner_address);