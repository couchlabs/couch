# Subscription Payment System Specification

## System Overview

A distributed payment system for managing crypto-native recurring payments using Base Account spend permissions. The system handles subscription lifecycle from initial charge through recurring orders, with automatic reconciliation and failure recovery.

### Design Principle: Onchain as Source of Truth

The system maintains a clear separation between onchain data (source of truth) and offchain data (operational state):

**Onchain Data (fetched when needed):**

- Permission status (active/revoked)
- Current period (start/end timestamps)
- Remaining allowance
- Permission parameters (amount, period, token)

**Offchain Data (stored in database):**

- Order schedule (when to charge)
- Retry attempts and failure reasons
- Transaction history
- Processing locks and operational state

This design prevents dual sources of truth - we never store period dates or permission status in the database, always fetching fresh from the blockchain when making charging decisions.

### Architecture

```
  ┌─────────────────────────┐
  │   subscription-api      │──────────► subscription-db
  └─────────────────────────┘                   ▲
                                                │
  ┌─────────────────────────┐                   │
  │     order-scheduler     │───────────────────┤
  │                         │                   │
  └───────────┬─────────────┘                   │
              ▼                                 │
          order-queue                           │
              ▼                                 │
  ┌─────────────────────────┐                   │
  │     order-processor     │───────────────────┤
  │                         │                   │
  └─────────────────────────┘                   │
                                                │
  ┌─────────────────────────┐                   │
  │ subscription-           │───────────────────┤
  │ reconciler-scheduler    │                   │
  └───────────┬─────────────┘                   │
              ▼                                 │
      subscription-revoke-queue                 │
              ▼                                 │
  ┌─────────────────────────┐                   │
  │ subscription-revoke-    │───────────────────┘
  │ consumer                │
  └─────────────────────────┘
```

### Core Components

1. **API GATEWAY** - CF Worker with Hono

- `subscription-api` # Main API service

2. **SCHEDULERS** - CF Workers with CRON triggers

- `order-scheduler` # Schedules order processing (\*/15)
- `subscription-reconciler-scheduler` # Audits permission consistency (\*/30)

3. **QUEUE PROCESSORS** - CF Workers

- `order-processor` # Processes orders
- `subscription-revoke-processor` # Revokes cancelled subscriptions

4. **QUEUES** - CF Queues

- `order-queue` # Queue for order processing
- `subscription-revoke-queue` # Queue for revocation tasks

5. **DATABASE** - CF D1

- `subscription-db` # D1 database

## Database Schema

```sql
-- Core subscription state (minimal - onchain is source of truth)
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY,  -- This IS the permission hash from onchain
  status TEXT NOT NULL,  -- 'processing', 'active', 'inactive'
  account_address TEXT NOT NULL,  -- User's wallet address
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders (individual charges for subscriptions)
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'initial', 'recurring', 'retry'
  due_at DATETIME NOT NULL,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL,  -- 'pending', 'processing', 'paid', 'failed'
  attempts INTEGER DEFAULT 0,
  parent_order_id INTEGER,  -- Links retry orders to original failed order
  failure_reason TEXT,  -- 'insufficient_funds', 'permission_expired', 'network_error', etc.
  processing_lock DATETIME,
  locked_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Transaction log (actual onchain transactions)
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  subscription_id TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  amount TEXT NOT NULL,  -- In USDC base units
  status TEXT NOT NULL,  -- 'pending', 'confirmed', 'failed'
  failure_reason TEXT,
  gas_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id)
);

-- Indexes for performance
CREATE INDEX idx_orders_due_status ON orders(due_at, status);
CREATE INDEX idx_orders_processing ON orders(processing_lock, status);
CREATE INDEX idx_orders_subscription ON orders(subscription_id);
CREATE INDEX idx_transactions_subscription ON transactions(subscription_id);
CREATE INDEX idx_transactions_order ON transactions(order_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_account ON subscriptions(account_address);
```

## API Endpoints

### Create Subscription

`POST /api/subscriptions`

Creates a new subscription with immediate first charge.

**Request:**

```json
{
  "subscription_id": "0x123..." // Permission hash from spend permission
}
```

**Response (202):**

```json
{
  "data": {
    "subscription_id": "0x123...",
    "transaction_hash": "0xabc...",
    "next_order_date": "2024-02-01T00:00:00Z"
  }
}
```

**Error Responses:**

- `400` - Invalid request
- `402` - Payment failed
- `409` - Subscription already exists
- `422` - Permission not active

**Implementation:**

1. Insert subscription with `status='processing'` (atomic lock)
2. Store `account_address` for future permission queries
3. Fetch permission from onchain to validate it's active
4. Execute first charge via CDP
5. Create first transaction record
6. Create next order (due_at calculated from onchain period)
7. Update subscription to `status='active'`
8. On failure: delete subscription and revoke permission

## Schedulers

### order-scheduler

**Schedule:** Every 15 minutes
**Purpose:** Find and enqueue due orders
**Source:** ONLY reads from `orders` table

**Implementation:**

```sql
-- Atomic claim prevents double-processing
UPDATE orders
SET status = 'processing',
    processing_lock = datetime('now'),
    locked_by = ?
WHERE id IN (
  SELECT id FROM orders
  WHERE status = 'pending'
    AND due_at <= datetime('now')
    AND processing_lock IS NULL
  LIMIT 50
)
RETURNING *
```

The scheduler is simple - it only finds due entries and enqueues them. It does NOT:

- Calculate next order dates
- Check subscription states
- Make business decisions

All intelligence is in the consumer that creates new orders.

### subscription-reconciler-scheduler

**Schedule:** Every 30 minutes
**Purpose:** Maintain consistency between onchain permissions and database

**Actions:**

1. Clean orphaned permissions (using KV cache for efficiency):
   - Fetch permissions where we're the spender
   - Check each against database
   - Revoke if not in our system
   - Track processed permissions in KV to avoid reprocessing
2. Clean stuck subscriptions (processing > 30 minutes)
3. Missing permissions detected on charge failure (not proactively checked)

## Queue Workers

### order-processor

**Queue:** `order-queue`
**Concurrency:** 10 workers
**Retry:** 3 attempts with exponential backoff

**Process:**

1. Fetch current permission state from onchain (using account_address and subscription_id)
2. Verify permission is active and allows charge
3. Execute charge via CDP using onchain parameters
4. Create transaction record
5. Mark order complete
6. Create next order (perpetual cycle)
7. On failure:
   - Permission expired/revoked: Mark subscription inactive
   - Technical errors (network, timeout): Use queue retry (exponential backoff)
   - Business errors (insufficient funds):
     - Mark entry as 'failed'
     - Create new retry order with custom date (+1 day, +3 days, +7 days)
     - After max retries: mark subscription inactive

**Order Lifecycle:**

- API creates first order when subscription starts
- Each successful charge creates the next order
- Failed charges create retry orders with custom schedules
- The orders table drives scheduling, but always validates against onchain state

### subscription-revoke-consumer

**Queue:** `subscription-revoke-queue`
**Concurrency:** 10 workers
**Retry:** 3 attempts

**Process:**

1. Call CDP revoke permission
2. Log revocation
3. Clean database records

## Configuration

```toml
# wrangler.toml
name = "subscription-system"

[triggers]
crons = ["*/15 * * * *", "*/30 * * * *"]

[[queues.consumers]]
queue = "order-queue"
max_batch_size = 10
max_retries = 3

[[queues.consumers]]
queue = "subscription-revoke-queue"
max_batch_size = 10
max_retries = 3

[[d1_databases]]
binding = "DB"
database_name = "subscription-db"
```

## Operational Considerations

### Idempotency

- Atomic `INSERT OR IGNORE` prevents duplicate subscriptions
- `UPDATE...RETURNING` ensures each order processed once
- Transaction `tx_hash` uniqueness prevents double charges

### Failure Recovery

- Technical failures: Queue retries (seconds/minutes, exponential backoff)
- Business failures: New orders with custom retry schedule (days/weeks)
- Stuck subscriptions auto-cleaned after 30 minutes
- Orphaned permissions revoked via KV-cached reconciliation

### Monitoring

- Track order status distribution
- Alert on high failure rates
- Monitor queue depth and processing time

### Scaling

- Database indexes optimized for queue patterns
- Stateless workers allow horizontal scaling
- Queue batching reduces database load

## Security

- Permission validation before any charge
- Atomic locks prevent race conditions
- CDP manages private keys securely
- No sensitive data in logs

## Future Considerations

- Webhook notifications
- Subscription plan changes
- Grace periods for failed payments
- Usage-based payment support
