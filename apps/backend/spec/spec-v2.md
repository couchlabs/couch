# Account System & Webhooks Specification - V1

## System Overview

A minimal account management and webhook system that enables developers to integrate Couch's subscription payment infrastructure into their applications. The system provides API key authentication and webhook notifications for subscription events.

### Design Principles

- **Web3-Native Identity:** EVM addresses as primary account identifiers
- **Single Event Type:** One webhook event for all subscription changes
- **Minimal Surface Area:** 4 endpoints total for v1

### Architecture

```
  ┌─────────────────────────┐
  │   subscription-api      │──────────► subscription-db
  │   (with auth middleware)│                ▲
  └───────────┬─────────────┘                │
              │                              │
              ▼                              │
       webhook-queue                         │
              │                              │
              ▼                              │
  ┌─────────────────────────┐                │
  │  webhook-delivery       │────────────────┤
  │                         │                │
  └─────────────────────────┘                │
                                             │
  ┌─────────────────────────┐                │
  │    order-processor      │────────────────┤
  │                         │                │
  └───────────┬─────────────┘                │
              │                              │
              └──────────────────────────────┘
                   (emits webhook events)
```

### Core Components

1. **SERVICES** - CF Workers with Hono
   - `subscription-api` - Account, API key, webhook, and subscription management with auth

2. **CONSUMERS** - CF Queue Consumers
   - `order-processor` - Processes orders from order-queue
   - `webhook-delivery` - Delivers webhook events from webhook-queue

3. **QUEUES** - CF Queues
   - `order-queue` - Queue for order processing
   - `webhook-queue` - Queue for webhook delivery

4. **DATABASE** - CF D1
   - `subscription-db` - Extended with accounts, api_keys, and webhooks tables

## Database Schema

```sql
-- Accounts table (tied to wallet address)
CREATE TABLE accounts (
    evm_address TEXT PRIMARY KEY,       -- Checksummed address (0x...)
    created_at INTEGER NOT NULL         -- Unix timestamp
);

-- API Keys table
CREATE TABLE api_keys (
    key_hash TEXT PRIMARY KEY,          -- SHA-256 hash of the actual key
    evm_address TEXT NOT NULL REFERENCES accounts(evm_address),
    key_prefix TEXT NOT NULL,           -- First ~16 chars for identification
    created_at INTEGER NOT NULL         -- Unix timestamp
);

-- Single webhook per account
CREATE TABLE webhooks (
    evm_address TEXT PRIMARY KEY REFERENCES accounts(evm_address),
    url TEXT NOT NULL,                  -- HTTPS URL
    secret TEXT NOT NULL,               -- For HMAC signature verification
    created_at INTEGER NOT NULL         -- Unix timestamp
);

-- Link subscriptions to accounts
ALTER TABLE subscriptions ADD COLUMN evm_address TEXT REFERENCES accounts(evm_address);
```

## API Endpoints (4 Total)

### 1. Create Account / Recover Access

`POST /api/account`

Creates a new account or recovers access to an existing one.

**Request:**

```json
{
  "evm_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0fA4b"
}
```

**Response (200):**

```json
{
  "api_key": "ck_live_a3f4b2c1d5e6..." // Full API key - only shown once
}
```

**Notes:**

- First call creates account (permissionless)
- Subsequent calls could require signature in v2 for security
- Always returns a new API key

### 2. Create Additional API Key

`POST /api/api-keys`

**Headers:** `X-API-Key: ck_live_...` (existing key for auth)

**Request:**

```json
{
  // empty for v1, or could add optional metadata later
}
```

**Response (201):**

```json
{
  "data": {
    "id": "key_xyz789",
    "api_key": "ck_live_a3f4b2c1d5e6...", // FULL KEY - ONLY SHOWN ONCE
    "api_key_prefix": "ck_live_a3f4b2c1", // For future identification
    "created_at": 1234567890,
    "warning": "Save this API key securely. You won't be able to see it again."
  }
}
```

#### List API Keys

`GET /api/accounts/{account_id}/api-keys`

**Headers:** `X-API-Key: ck_live_...`

**Response (201):**

```json
{
  "api_key": "ck_live_xyz987def..." // New API key - only shown once
}
```

### 3. Set Webhook URL

`PUT /api/webhook`

Creates or updates the webhook URL for the account.

**Headers:** `X-API-Key: ck_live_...`

**Request:**

```json
{
  "url": "https://api.example.com/webhooks/couch"
}
```

**Response (200):**

```json
{
  "secret": "whsec_abc123def456" // For HMAC verification
}
```

### 4. Create Subscription

`POST /api/subscriptions`

Activates a subscription (requires authentication).

**Headers:** `X-API-Key: ck_live_...`

**Request:**

```json
{
  "subscription_id": "0x..."
}
```

**Response:** (same as current implementation, subscription linked to authenticated account)

## Webhook Event: `subscription.updated`

### Event Structure

Single event type with domain-aligned structure:

```json
{
  "id": "evt_1234567890",
  "type": "subscription.updated",
  "created_at": 1234567890,
  "data": {
    "subscription": {
      "id": "0x...",
      "status": "active" | "inactive" | "failed" | "canceled",
      "account_address": "0x...",
      "current_period_end": 1234567890  // if active
    },
    "order": {  // if this event relates to a payment
      "number": 3,  // Sequential number relative to subscription
      "type": "initial" | "recurring",
      "amount": "0.0009",
      "status": "paid" | "failed"
    },
    "transaction": {  // if payment was successful
      "hash": "0x...",
      "amount": "0.0009",
      "confirmed_at": 1234567890
    },
    "error": {  // if payment failed
      "code": "insufficient_balance",
      "message": "ERC20: transfer amount exceeds balance"
    }
  }
}
```

### Event Examples

**Initial Charge Success:**

```json
{
  "type": "subscription.updated",
  "data": {
    "subscription": {
      "id": "0xabc...",
      "status": "active",
      "account_address": "0x123...",
      "current_period_end": 1234567890
    },
    "order": {
      "number": 1,
      "type": "initial",
      "amount": "0.0009",
      "status": "paid"
    },
    "transaction": {
      "hash": "0xdef...",
      "amount": "0.0009",
      "confirmed_at": 1234567890
    }
  }
}
```

**Recurring Payment Failure:**

```json
{
  "type": "subscription.updated",
  "data": {
    "subscription": {
      "id": "0xabc...",
      "status": "inactive",
      "account_address": "0x123..."
    },
    "order": {
      "number": 3,
      "type": "recurring",
      "amount": "0.0009",
      "status": "failed"
    },
    "error": {
      "code": "insufficient_balance",
      "message": "ERC20: transfer amount exceeds balance"
    }
  }
}
```

**Cancellation:**

```json
{
  "type": "subscription.updated",
  "data": {
    "subscription": {
      "id": "0xabc...",
      "status": "canceled",
      "account_address": "0x123..."
    }
  }
}
```

### Webhook Security

**HMAC Signature Verification:**

```typescript
const signature = crypto.subtle.sign("HMAC", secret, JSON.stringify(payload))

// Sent as header
"X-Couch-Signature: sha256=" + base64(signature)
```

## Authentication Middleware

```typescript
async function authenticateRequest(request: Request, env: Env) {
  const apiKey = request.headers.get("X-API-Key")
  if (!apiKey) throw new AuthError("Missing API key")

  const keyHash = await hashApiKey(apiKey)
  const result = await env.DB.prepare(
    "SELECT evm_address FROM api_keys WHERE key_hash = ?",
  )
    .bind(keyHash)
    .first()

  if (!result) throw new AuthError("Invalid API key")

  return result.evm_address // Return EVM address instead of account_id
}
```

## Webhook Event Emission

Events are emitted when subscription state changes:

```typescript
// Emit webhook event for subscription updates
async function emitSubscriptionEvent(env, evmAddress, eventData) {
  // Get webhook for this account (single webhook per account in v1)
  const webhook = await env.DB.prepare(
    "SELECT * FROM webhooks WHERE evm_address = ?",
  )
    .bind(evmAddress)
    .first()

  if (!webhook) return // No webhook configured

  const event = {
    id: `evt_${crypto.randomUUID()}`,
    type: "subscription.updated",
    created_at: Date.now(),
    data: eventData, // Contains subscription, order, transaction, error
  }

  // Queue webhook delivery
  await env.WEBHOOK_QUEUE.send(
    {
      webhook_url: webhook.url,
      webhook_secret: webhook.secret,
      event: event,
    },
    {
      contentType: "json",
      deduplicationId: event.id,
    },
  )
}
```

## Webhook Delivery

```typescript
async function deliverWebhook(message: WebhookMessage, env: Env) {
  const { webhook_url, webhook_secret, event } = message

  // Generate HMAC signature
  const signature = await generateHMAC(webhook_secret, event)

  // Attempt delivery
  const response = await fetch(webhook_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Couch-Signature": `sha256=${signature}`,
      "X-Couch-Event-Id": event.id,
      "X-Couch-Event-Type": event.type,
    },
    body: JSON.stringify(event),
  })

  // Retry logic for failures
  if (!response.ok && message.attempts < 3) {
    throw new Error("Retry webhook delivery") // Queue will retry
  }
}
```

## Configuration

All infrastructure and configuration is managed through Alchemy IaC in `alchemy.run.ts`.
Follow the existing patterns for Workers, Queues, and Databases when adding new resources.

## Implementation Plan

### Phase 1: Account System & Authentication
1. **Database schema** - Add accounts and api_keys tables
2. **Account endpoints** - `POST /api/account`, `POST /api/api-keys`
3. **Auth middleware** - API key validation
4. **Update subscription endpoint** - Add authentication, link subscriptions to accounts
5. **Test** - Ensure existing subscription flow works with auth

### Phase 2: Webhook Endpoint
1. **Database schema** - Add webhooks table
2. **Webhook endpoint** - `PUT /api/webhook` for setting webhook URL
3. **Webhook secret generation** - HMAC secret per account
4. **Test** - Webhook CRUD operations

### Phase 3: Webhook Delivery System
1. **Queue setup** - Create webhook-queue in alchemy.run.ts
2. **Webhook delivery consumer** - Process and deliver webhooks
3. **Event emission** - Integrate `emitSubscriptionEvent` in:
   - Subscription activation (subscription.service.ts)
   - Order processing (order-processor.ts)
4. **HMAC signatures** - Sign all outgoing webhooks
5. **Test** - End-to-end webhook delivery

### V2 - Future Enhancements

- Multiple webhooks per account
- Additional event types (order.created, order.paid)
- Signature verification for account recovery
- Webhook delivery tracking and debugging
- Rate limiting and usage analytics

## Security

- **API Keys:** Stored as SHA-256 hashes, never in plaintext
- **Webhook Signatures:** HMAC-SHA256 on all payloads
- **Account Isolation:** Via foreign key constraints
- **HTTPS Required:** For all webhook URLs

## Summary

This V1 specification provides:

- **4 simple endpoints** for complete functionality
- **Single webhook event** that covers all subscription changes
- **Web3-native** identity with EVM addresses
- **Clear upgrade path** to V2 with additional features
