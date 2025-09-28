# Subscription Backend Service

A stablecoin subscription payment system built on Cloudflare Workers, using Coinbase CDP for payment processing and Base network for blockchain operations.

> **Getting Started**: See the [Getting Started guide](../../README.md#getting-started) in the main README for initial setup instructions.

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client    │────▶│     API      │────▶│ Database(D1) │
└─────────────┘     └──────────────┘     └──────────────┘
                           │                     ▲
                           │                     │
                           │              ┌──────────────┐
                           │              │    Order     │
                           │              │  Scheduler   │
                           │              └──────────────┘
                           │                     │
                           │                     ▼
                           │              ┌──────────────┐
                           │              │    Order     │
                           │              │    Queue     │
                           │              └──────────────┘
                           │                     │
                           │                     ▼
                           │              ┌──────────────┐
                           └─────────────▶│    Order     │
                                          │  Processor   │
                                          └──────────────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │  Blockchain  │
                                          │    (Base)    │
                                          └──────────────┘

Note: API accesses Blockchain directly for initial activation (onchain first charge + offchain setup)
      Order Processor accesses Blockchain for recurring payments
      Both API, Order Scheduler, and Order Processor access the same D1 database
```

## Testing Guide

### Option A: Using the Frontend App (Recommended)

The easiest way to test is using the frontend app included in this monorepo:

```bash
# In the root directory
bun dev

# Navigate to http://localhost:5173
# The frontend handles subscription creation and activation automatically
# Clean localstorage to create new subscriptions
```

### Option B: Manual Testing with SDK

#### 1. Create a Test Subscription (1-minute period)

Create a subscription with a short period for testing:

```javascript
// Use the Coinbase SDK with overridePeriodInSeconds
import { subscribe } from "@base-org/account/payment"

const subscription = await subscribe({
  recurringCharge: "0.0009",
  subscriptionOwner: "0x...",
  periodInDays: 30, // Will be overridden
  overridePeriodInSeconds: 60, // 1-minute period for testing
  testnet: true,
})

console.log("Subscription ID:", subscription.id)
```

#### 2. Activate the Subscription

Using the subscription ID from step 1:

```bash
curl -X POST http://localhost:3000/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{
    "subscription_id": "<subscription.id>"
  }'
```

Expected response:

```json
{
  "data": {
    "subscription_id": "0xa123...",
    "transaction_hash": "0x456...",
    "next_order_date": "2025-09-25T17:25:26.000Z"
  }
}
```

### Step 3: Trigger Scheduler Manually

The scheduler [in dev mode](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/#background) doesn't runs automatically, you can trigger it manually:

```bash
curl http://localhost:3100/__scheduled
```

Check logs to see:

- "Found X due orders"
- "Successfully queued X orders for processing"

### Step 4: Monitor Recurring Payments

Watch the logs to see the complete flow:

```bash
# Scheduler finds due entries
INFO: Found 1 due orders
INFO: Sending order to queue

# Processor processes payment
INFO: Processing batch of 1 charge messages
INFO: Processing recurring payment
INFO: Onchain charge successful
INFO: Creating next order
```

### Step 5: Check Database State

```bash
# View subscriptions
sqlite3 ../../alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject/<generated_hash>.sqlite \
  "SELECT * FROM subscriptions"

# View orders
sqlite3 ../../alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject/<generated_hash>.sqlite \
  "SELECT id, status, due_at, amount FROM orders ORDER BY id DESC"

# View transactions
sqlite3 ../../alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject/<generated_hash>.sqlite \
  "SELECT transaction_hash, amount, created_at FROM transactions"
```

## API Endpoints

### Health Check

```
GET /health
```

### Activate Subscription

```
POST /api/subscriptions
Body: {
  "subscription_id": "0x..."
}
```

## System Components

### 1. API Service (`subscription-api`)

- Handles HTTP requests
- Activates new subscriptions
- Processes initial payments
- Reads/writes to D1 database

### 2. Scheduler (`order-scheduler`)

- Runs every 15 minutes
- Claims due orders atomically from D1
- Sends charge tasks to queue
- Updates order status in D1

### 3. Queue (`order-queue`)

- Buffers charge tasks
- Handles retries (3 attempts)
- Ensures reliable processing

### 4. Processor (`order-processor`)

- Processes charge messages from queue
- Executes blockchain transactions on Base
- Updates D1 with transaction results
- Creates next orders in D1

## Troubleshooting

### Common Issues

1. **"No due orders found"**
   - Check datetime format in database (should be ISO 8601 with 'Z')
   - Verify subscription is active
   - Check if current time > due_at

2. **"Remaining spend amount is insufficient"**
   - Subscription period hasn't started yet
   - User hasn't approved sufficient spending allowance

3. **Payment failures**
   - Check user's USDC balance
   - Verify spend permission is active
   - Ensure CDP credentials are correct
