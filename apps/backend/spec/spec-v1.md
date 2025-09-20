# Subscription Billing System Specification

## System Overview

A distributed billing system for managing crypto-native recurring payments using Base Account spend permissions. The system handles subscription lifecycle from initial charge through recurring billing, with automatic reconciliation and failure recovery.

### Architecture

```
┌─────────────────┐     ┌───────────────┐      ┌────────────┐
│   API Gateway   │────▶│  D1 Database  │◀─────│ Schedulers │
└────────┬────────┘     └───────────────┘      └─────┬──────┘
         │                                           │
         ▼                                           ▼
┌─────────────────┐                         ┌───────────────┐
│  Charge Queue   │◀────────────────────────│  Revoke Queue │
└────────┬────────┘                         └────────┬──────┘
         │                                           │
         ▼                                           ▼
┌─────────────────┐                        ┌────────────────┐
│ Charge Workers  │                        │ Revoke Workers │
└─────────────────┘                        └────────────────┘
```

1. API Gateway → D1 Database: Direct connection for subscription creation and queries
2. Schedulers → D1 Database: Bidirectional for reading subscriptions and updating states
3. Schedulers → Queues: One-way flow to enqueue work items to both Charge Queue and Revoke Queue
4. Queues → Workers: One-way flow from each queue to its respective workers
5. Workers → D1 Database: Implicit connection (workers need DB access to process charges/revocations)

### Core Components

1. **API Gateway** - Handles subscription creation and execute/validates initial payment
2. **Schedulers** - Two cron jobs managing charge processing and permission reconciliation
3. **Queue System** - Distributed work queues for charge and revocation processing
4. **Workers** - Stateless processors executing charges and revocations
5. **Database** - Source of truth for subscriptions, billing entries, and transactions

## Database Schema

```sql
-- Core subscription state
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,  -- 'processing', 'active', 'inactive'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Billing schedule and state
CREATE TABLE billing_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'first_charge', 'recurring'
  due_at DATETIME NOT NULL,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'pending', 'processing', 'completed', 'failed'
  attempts INTEGER DEFAULT 0,
  processing_lock DATETIME,
  locked_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(subscription_id),
  INDEX idx_due_status (due_at, status),
  INDEX idx_processing (processing_lock, status)
);

-- Transaction log
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  billing_entry_id INTEGER NOT NULL,
  subscription_id TEXT NOT NULL,
  tx_hash TEXT UNIQUE,
  amount TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'confirmed', 'failed'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (billing_entry_id) REFERENCES billing_entries(id),
  INDEX idx_subscription (subscription_id)
);
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
    "next_billing_date": "2024-02-01T00:00:00Z"
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
2. Validate spend permission is active
3. Execute first charge via CDP
4. Create first transaction record
5. Create next billing entry
6. Update subscription to `status='active'`
7. On failure: delete subscription and revoke permission

## Schedulers

### Charge Scheduler

**Schedule:** Every 15 minutes
**Purpose:** Process due billing entries

**Implementation:**

```sql
-- Atomic claim prevents double-processing
UPDATE billing_entries
SET status = 'processing',
    processing_lock = datetime('now'),
    locked_by = ?
WHERE id IN (
  SELECT id FROM billing_entries
  WHERE status = 'pending'
    AND due_at <= datetime('now')
    AND processing_lock IS NULL
  LIMIT 50
)
RETURNING *
```

Enqueues claimed entries to charge queue for processing.

### Permission Reconciler

**Schedule:** Every 30 minutes
**Purpose:** Maintain consistency between onchain permissions and database

**Actions:**

1. Fetch active permissions from base
2. Revoke orphaned permissions (onchain but not in DB)
3. Clean stuck subscriptions (processing > 30 minutes)
4. Mark inactive for missing permissions (in DB but not active onchain)

## Queue Workers

### Charge Worker

**Queue:** `charge-queue`
**Concurrency:** 10 workers
**Retry:** 3 attempts with exponential backoff

**Process:**

1. Execute charge via CDP
2. Create transaction record
3. Mark billing entry complete
4. Create next billing entry
5. On failure: retry or mark inactive after max attempts

### Revoke Worker

**Queue:** `revoke-queue`
**Concurrency:** 5 workers
**Retry:** 3 attempts

**Process:**

1. Call CDP revoke permission
2. Log revocation
3. Clean database records

## Configuration

```toml
# wrangler.toml
name = "subscription-billing"

[triggers]
crons = ["*/1 * * * *", "*/5 * * * *"]

[[queues.consumers]]
queue = "charge-queue"
max_batch_size = 10
max_retries = 3

[[queues.consumers]]
queue = "revoke-queue"
max_batch_size = 5
max_retries = 3

[[d1_databases]]
binding = "DB"
database_name = "subscriptions"
```

## Operational Considerations

### Idempotency

- Atomic `INSERT OR IGNORE` prevents duplicate subscriptions
- `UPDATE...RETURNING` ensures each billing entry processed once
- Transaction `tx_hash` uniqueness prevents double charges

### Failure Recovery

- Failed charges retry 3 times with exponential backoff
- Stuck subscriptions auto-cleaned after 5 minutes
- Orphaned permissions revoked automatically

### Monitoring

- Track billing entry status distribution
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
- Usage-based billing support
