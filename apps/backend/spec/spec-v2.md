# Account System & Webhooks Specification - V1

## System Overview

A minimal account management and webhook system that enables developers to integrate Couch's subscription payment infrastructure into their applications. The system provides API key authentication and webhook notifications for subscription events.

### Payment Flow

Couch enables merchants to collect recurring USDC payments from their subscribers:

```
Subscriber Wallet → [Couch Smart Wallet charges] → Merchant's evm_address
```

**Three Key Roles:**

1. **Subscriber** (not currently stored - SDK limitation)
   - The end user who signs the subscription permission
   - Their wallet that holds the USDC being charged
   - Approves Couch as the spender
   - Note: `subscriptionPayer` available during creation but not from `getStatus`

2. **Owner** (`owner_address` in subscriptions table - Couch's wallet)
   - Couch's CDP smart wallet that has permission to execute charges
   - Acts as the "spender" in the Base Account permission system
   - Same for all subscriptions (Couch is always the owner/charger)

3. **Recipient** (`evm_address` in accounts table - the Merchant)
   - The merchant/developer using Couch's API
   - Receives the USDC payments from subscriptions
   - Identified by their EVM address in the accounts system

**Flow:**

1. **Subscriber** approves spend permission for **Couch (owner)** via frontend SDK
2. **Couch (owner)** executes charges on subscriptions
3. **Merchant (recipient)** receives USDC directly to their `evm_address`

The merchant's `evm_address` serves dual purposes:

- **Identity:** Primary key for the account system
- **Payment Recipient:** Where subscription payments are sent via the `recipient` parameter in the [Base Account SDK charge method](https://github.com/base/account-sdk/blob/master/packages/account-sdk/src/interface/payment/charge.ts)

**Security Note:** This dual-purpose design is powerful because signature verification (V2) will guarantee that whoever controls the API keys also has access to the funds. No one can redirect payments to an address they don't control.

### Design Principles

- **Web3-Native Identity:** EVM addresses as primary account identifiers and payment recipients
- **Direct Payment:** Subscribers pay directly to merchants (no intermediary custody)
- **Single Event Type:** One webhook event for all subscription changes
- **Minimal Surface Area:** 3 endpoints total for v1

### Architecture

```
  ┌─────────────────────────┐
  │         api             │──────────► db
  │   (with auth middleware)│           ▲
  └───────────┬─────────────┘           │
              │                              │
              │ (emits webhook events)       │
              ▼                              │
         webhook-queue                       │
              │                              │
              ▼                              │
  ┌─────────────────────────┐                │
  │   webhook-delivery      │────────────────┘
  │                         │   (reads webhooks table)
  └─────────────────────────┘

  ┌─────────────────────────┐
  │    order-processor      │──────────► db
  │                         │           ▲
  └───────────┬─────────────┘           │
              │                              │
              │ (emits webhook events)       │
              ▼                              │
         webhook-queue ──────────────────────┘
```

### Core Components

1. **SERVICES** - CF Workers with Hono
   - `api` - Account, API key, webhook, and subscription management with auth

2. **CONSUMERS** - CF Queue Consumers
   - `order-processor` - Processes orders from order-queue
   - `webhook-delivery` - Delivers webhook events from webhook-queue

3. **QUEUES** - CF Queues
   - `order-queue` - Queue for order processing
   - `webhook-queue` - Queue for webhook delivery

4. **DATABASE** - CF D1
   - `db` - Single database with all tables (subscriptions, orders, accounts, api_keys, webhooks)

## Database Schema

```sql
-- Accounts table (tied to wallet address)
CREATE TABLE accounts (
    evm_address TEXT PRIMARY KEY        -- Checksummed address (0x...)
);

-- API Keys table (V1: one key per account, V2: multiple)
CREATE TABLE api_keys (
    key_hash TEXT PRIMARY KEY,          -- SHA-256 hash of the actual key
    evm_address TEXT NOT NULL REFERENCES accounts(evm_address) ON DELETE CASCADE
);

-- Single webhook per account
CREATE TABLE webhooks (
    evm_address TEXT PRIMARY KEY REFERENCES accounts(evm_address) ON DELETE CASCADE,
    url TEXT NOT NULL,                  -- HTTPS URL
    secret TEXT NOT NULL                -- For HMAC signature verification
);

-- Link subscriptions to accounts
ALTER TABLE subscriptions ADD COLUMN evm_address TEXT REFERENCES accounts(evm_address);

-- Add order sequence tracking
ALTER TABLE orders ADD COLUMN order_number INTEGER;
```

## API Endpoints (3 Total for V1)

### 1. Create Account / Rotate API Key

`PUT /api/account`

Creates a new account or rotates the API key for an existing account.

**Request:**

```json
{
  "address": "0x123abc..."
}
```

**Response (200):**

```json
{
  "api_key": "ck_prod_456def..." // Full API key - only shown once
}
```

**API Key Format:**

- Prefix based on `STAGE` environment variable: `ck_{stage}_`
- Examples:
  - `ck_prod_...` for production
  - `ck_sandbox_...` for sandbox
  - `ck_staging_...` for staging
  - `ck_dev_...` for development

**Behavior:**

- **New account:** Creates account and generates first API key
- **Existing account:** Replaces the existing API key (old key becomes invalid)
- **Security Note for V1:** No verification required - anyone can rotate keys for any address
- **V2 Enhancement:** Will require signature verification for existing accounts

**Implementation:**

```typescript
// Generate API key with stage-based prefix
import { Stage } from "@/lib/constants"

function generateApiKey(stage: Stage): string {
  const prefix = `ck_${stage}_`
  const randomPart = crypto.randomUUID().replace(/-/g, "")
  return `${prefix}${randomPart}`
}

// Hash only the secret part (without prefix)
function hashApiKey(apiKey: string): Promise<string> {
  // Strip the prefix before hashing
  const prefixMatch = apiKey.match(/^ck_[^_]+_(.+)$/)
  const secretPart = prefixMatch ? prefixMatch[1] : apiKey

  const encoder = new TextEncoder()
  const data = encoder.encode(secretPart)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Usage in endpoint handler
const apiKey = generateApiKey(env.STAGE)
const keyHash = await hashApiKey(apiKey) // Hashes only the secret part
```

```sql
-- For existing accounts, replace the key atomically
BEGIN TRANSACTION;
DELETE FROM api_keys WHERE evm_address = ?;
INSERT INTO api_keys (key_hash, evm_address) VALUES (?, ?);
COMMIT;
```

### 2. Set Webhook URL

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

**Validation:**

- URL must be a non-empty string starting with `https://`
- No connectivity tests - fails at delivery time if unreachable
- Same philosophy as subscriptions: validate when executing, not when storing

### 3. Create Subscription

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

**Future Enhancement Note:**

- The frontend's `subscribe()` call returns `subscriptionPayer` (the subscriber's address)
- Could accept optional `subscriber_address` parameter to store the payer's wallet
- Not in V1 scope, but if SDK doesn't add it to `getStatus()`, we could track it ourselves
- Would require adding `subscriber_address` column to subscriptions table

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
      "status": "inactive"
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
      "status": "canceled"
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

  return result.evm_address // Return EVM address for authorization
}
```

## Payment Integration

When processing subscription charges, the merchant's `evm_address` must be passed as the recipient:

```typescript
// In onchain.repository.ts
async chargeSubscription(params: {
  subscriptionId: Hash
  amount: string
  recipient: Address  // Merchant's evm_address from accounts table
}): Promise<ChargeTransactionResult> {
  const result = await charge({
    id: params.subscriptionId,
    amount: params.amount,
    recipient: params.recipient,  // Funds go directly to merchant
    // ... CDP config
  })
  return result
}
```

The flow for charges:

1. Look up merchant's `evm_address` from subscription's `evm_address` foreign key
2. Pass merchant address as `recipient` to charge method
3. USDC flows directly from subscriber → merchant

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

  // V1: No retries - log and move on
  if (!response.ok) {
    console.error(`Webhook delivery failed: ${response.status}`)
    // V2 will add retry logic here
  }
}
```

## Configuration

All infrastructure and configuration is managed through Alchemy IaC in `alchemy.run.ts`.

### Required Infrastructure Additions

Add the following to `alchemy.run.ts` after the existing order queue definitions:

```typescript
// -----------------------------------------------------------------------------
// WEBHOOK SYSTEM
// -----------------------------------------------------------------------------

// Webhook Queue - for delivering webhook events to merchants
const WEBHOOK_QUEUE_NAME = "webhook-queue"
export interface WebhookQueueMessage {
  url: string // Webhook URL to deliver to
  secret: string // HMAC secret for signing
  event: {
    // The actual event payload
    id: string
    type: string
    created_at: number
    data: any
  }
  attemptNumber: number // Current attempt (for retry logic)
}

export const webhookQueue = await Queue<WebhookQueueMessage>(
  WEBHOOK_QUEUE_NAME,
  {
    name: `${NAME_PREFIX}-${WEBHOOK_QUEUE_NAME}`,
  },
)

// -----------------------------------------------------------------------------
// WEBHOOK DELIVERY CONSUMER
// -----------------------------------------------------------------------------

// webhook-delivery: Processes webhook deliveries with retries
const WEBHOOK_DELIVERY_NAME = "webhook-delivery"
export const webhookDelivery = await Worker(WEBHOOK_DELIVERY_NAME, {
  name: `${NAME_PREFIX}-${WEBHOOK_DELIVERY_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "consumers",
    "webhook-delivery.ts",
  ),
  eventSources: [
    {
      queue: webhookQueue,
      settings: {
        batchSize: 10,
        maxConcurrency: 20,
        maxRetries: 0, // V1: No retries - fire and forget
      },
    },
  ],
  bindings: {
    DB: db, // For tracking delivery status if needed in V2
  },
  compatibilityFlags,
  dev: { port: 3300 },
})
```

### Update Existing Workers

Add webhook queue binding to workers that emit events:

```typescript
// Update api bindings
export const api = await Worker(API_NAME, {
  // ... existing config
  bindings: {
    // ... existing bindings
    WEBHOOK_QUEUE: webhookQueue, // Add this
  },
})

// Update orderProcessor bindings
export const orderProcessor = await Worker(ORDER_PROCESSOR_NAME, {
  // ... existing config
  bindings: {
    // ... existing bindings
    WEBHOOK_QUEUE: webhookQueue, // Add this
  },
})
```

## Implementation Plan

### Phase 1: Account System & Authentication

1. **Database schema** - Add accounts and api_keys tables (simplified, no timestamps)
2. **Account endpoint** - `PUT /api/account` for creation and key rotation
3. **Auth middleware** - API key validation via api_keys table
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

### Future Enhancements (V2 and beyond)

**Account & API Keys:**
- Signature verification for secure account operations
- Multiple API keys per account
- API key management endpoints (GET, DELETE)
- API key metadata (name, created_at, last_used_at)

**Webhooks:**
- GET /api/webhook - View current webhook
- DELETE /api/webhook - Remove webhook
- Multiple webhooks per account
- Additional event types (order.created, order.paid)
- Webhook delivery status tracking

**General:**
- Rate limiting and usage analytics
- More detailed error responses

## Security

- **API Keys:** Stored as SHA-256 hashes, never in plaintext
- **Webhook Signatures:** HMAC-SHA256 on all payloads
- **Account Isolation:** Via foreign key constraints
- **HTTPS Required:** For all webhook URLs

## Summary

This V1 specification provides the absolute minimum viable API:

- **3 endpoints only:**
  - `PUT /api/account` - Get API key
  - `PUT /api/webhook` - Set webhook URL
  - `POST /api/subscriptions` - Activate subscription
- **One API key per account** (rotatable)
- **Single webhook event** (`subscription.updated`) for all changes
- **Web3-native** identity with EVM addresses
- **Minimal surface area** - Add features as needed in future versions
