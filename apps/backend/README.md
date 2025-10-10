# Couch Backend Service

A stablecoin subscription payment system built on Cloudflare Edge Infrastructure.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture & Patterns](#architecture--patterns)
  - [Service/Repository Pattern](#servicerepository-pattern)
  - [Provider Abstraction](#provider-abstraction)
  - [Queue Consumers](#queue-consumers)
  - [Schedulers](#schedulers)
- [Core Concepts](#core-concepts)
  - [Subscription Lifecycle](#subscription-lifecycle)
  - [Dunning System](#dunning-system)
  - [Queue Reliability](#queue-reliability)
  - [Webhook Events](#webhook-events)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Development](#development)
  - [Testing Guide](#testing-guide)
  - [DEV Endpoints](#dev-endpoints)
  - [Monitoring](#monitoring)
- [Error Codes](#error-codes)

## Quick Start

> **Full Setup**: See the [Getting Started guide](../../README.md#getting-started) in the root README for complete monorepo setup including the playground app.

### Backend Only

1. **Install dependencies** (from monorepo root)
   ```bash
   bun install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in required values (CDP credentials, etc.)

3. **Run the backend**
   ```bash
   bun run dev --filter=backend
   ```

The backend starts with the following services:

| Service | Port | Purpose |
|---------|------|---------|
| API Gateway | 3000 | HTTP API endpoints |
| Order Scheduler | 3100 | Process due payments (cron: every 15 min)* |
| Dunning Scheduler | 3101 | Process payment retries (cron: every hour)* |
| Order Consumer | 3200 | Queue consumer for payment processing |
| Webhook Delivery | 3201 | Queue consumer for webhook delivery |
| Order DLQ Consumer | 3202 | Dead letter queue monitor for orders |
| Webhook DLQ Consumer | 3203 | Dead letter queue monitor for webhooks |

> **Note**: \*Cron triggers only run in production. Locally, use `GET http://localhost:3100/__scheduled` or `GET http://localhost:3101/__scheduled` to trigger manually, or use the playground app's Backend Settings dialog.

> **Tip**: Run the playground app alongside (`bun run dev --filter=playground`) for a full testing environment with webhook visualization and scheduler controls.

## Architecture & Patterns

### Service/Repository Pattern

The backend follows a layered architecture inspired by Domain-Driven Design:

```
src/
├── api/              # HTTP API layer
│   ├── routes/       # Route handlers (thin controllers)
│   └── middleware/   # Auth, error handling
├── services/         # Business logic layer
├── repositories/     # Data access layer (database & onchain operations)
├── providers/        # Onchain provider abstractions
├── consumers/        # Queue message consumers
├── schedulers/       # Cron-triggered background jobs
├── errors/           # Custom error classes
├── lib/              # Shared utilities (logger, etc.)
├── constants/        # Configuration and constants
└── types/            # Infra Type definitions (env, bindings)
```

**Layer Responsibilities:**

- **Routes** (`api/routes/*.routes.ts`): Handle HTTP requests, validate input, call services
- **Services** (`services/*.service.ts`): Contain business logic, orchestrate operations, handle errors
- **Repositories** (`repositories/*.repository.ts`): Execute database queries and onchain operations
- **Providers** (`providers/*.provider.ts`): Abstract blockchain interactions (Base, etc.)

**Example Flow:**
```
POST /api/subscriptions
  → subscriptions.routes.ts (validate request)
    → subscription.service.ts (business logic)
      → subscription.repository.ts (DB insert)
      → onchain.repository.ts (verify onchain permission)
      → order.service.ts (process initial charge)
        → onchain.repository.ts (handle onchain transaction)
        → webhook.service.ts (emit webhook event)
```

Each domain follows a consistent structure:

**Service Layer** (`services/*.service.ts`)
- Business logic and workflow orchestration
- Error handling and validation
- Coordinates multiple repositories
- Transaction management

```typescript
export class SubscriptionService {
  constructor(env) {
    this.subscriptionRepository = new SubscriptionRepository(env)
    this.onchainRepository = new OnchainRepository(env)
  }

  async activateSubscription(params): Promise<ActivationResult> {
    // 1. Verify onchain permission
    const permission = await this.onchainRepository.getPermission(...)

    // 2. Process initial charge
    const charge = await this.onchainRepository.chargeSubscription(...)

    // 3. Record in database
    await this.subscriptionRepository.createSubscription(...)

    return result
  }
}
```

**Repository Layer** (`repositories/*.repository.ts`)
- Database access via Drizzle ORM
- Query building and execution
- Returns domain objects
- No business logic

```typescript
export class SubscriptionRepository {
  async createSubscription(params): Promise<void> {
    await this.db.insert(subscriptions).values({
      id: params.subscriptionId,
      accountAddress: params.accountAddress,
      status: SubscriptionStatus.ACTIVE,
    })
  }
}
```

### Provider Abstraction

The `providers/` directory abstracts blockchain interactions to support multiple sdk:

```
providers/
├── provider.interface.ts   # Common interface
├── base.provider.ts        # Base implementation
└── onchain.repository.ts   # Provider-agnostic repository
```

**Key Methods:**
- `chargeSubscription()` - Execute onchain payment
- `getSubscriptionStatus()` - Query onchain permission state
- `getPermission()` - Fetch permission details

This abstraction, inspired by BASE Account SDK, allows adding new sdk/chain (Crossmint, Optimism, Arbitrum, ..), or user lower level primitives in case we need access to features not exposed by sdks, without modifying service logic.

### Queue Consumers

Asynchronous processing is handled via Cloudflare Queues with dedicated consumer workers:

**Order Consumer** (`consumers/order.consumer.ts`)
- Processes recurring payment charges
- Handles dunning retry logic
- Updates subscription status
- Emits webhook events

**Webhook Consumer** (`consumers/webhook.consumer.ts`)
- Delivers signed webhooks to merchant endpoints
- Implements exponential backoff (5s → 15min)
- Routes failed deliveries to DLQ after 10 attempts

**DLQ Consumers** (`consumers/*.dlq.consumer.ts`)
- Monitor dead letter queues
- Log permanently failed messages
- Alert on system errors

### Schedulers

Cron-triggered workers that query the database and enqueue work:

**Order Scheduler** (`schedulers/order-scheduler.ts`)
- **Cron**: Every 15 minutes
- **Purpose**: Find orders with `due_at <= now` and `status = pending`
- **Action**: Push order IDs to `ORDER_QUEUE`

**Dunning Scheduler** (`schedulers/dunning-scheduler.ts`)
- **Cron**: Every hour
- **Purpose**: Find orders with `next_retry_at <= now` and `status = failed`
- **Action**: Push order IDs to `ORDER_QUEUE` for retry

## Core Concepts

### Subscription Lifecycle

Subscriptions transition through 6 possible states:

```
PROCESSING → ACTIVE → PAST_DUE → UNPAID
    ↓           ↓          ↓
INCOMPLETE  CANCELED   CANCELED
```

**Status Definitions**

- **PROCESSING**: Initial state when subscription is created, before activation charge
- **INCOMPLETE**: Activation charge failed (insufficient balance, expired permission, etc.)
- **ACTIVE**: Subscription is active and recurring payments are being processed
- **PAST_DUE**: Payment failed but retries are scheduled (dunning system active)
- **UNPAID**: Payment retries exhausted, subscription requires manual intervention
- **CANCELED**: Subscription terminated (permission revoked/expired or manually canceled)

**Status Transitions**

| From | To | Trigger |
|------|------|---------|
| PROCESSING | ACTIVE | Initial charge succeeds |
| PROCESSING | INCOMPLETE | Initial charge fails |
| ACTIVE | PAST_DUE | Recurring payment fails (retryable error) |
| ACTIVE | CANCELED | Permission revoked/expired (terminal error) |
| PAST_DUE | ACTIVE | Retry succeeds |
| PAST_DUE | UNPAID | Max retries exhausted (4 attempts over 21 days) |
| PAST_DUE | CANCELED | Permission revoked/expired during retry period |

### Dunning System

The dunning system automatically retries failed recurring payments to recover from temporary issues (e.g., insufficient balance).

**Retry Schedule**

Failed payments trigger up to **4 retry attempts** over **21 days**:

| Attempt | Delay After Failure | Cumulative Time | Label |
|---------|---------------------|-----------------|-------|
| 1 (Initial) | Immediate | 0 days | initial charge |
| 2 | 2 days | 2 days | early retry |
| 3 | 5 days | 7 days | standard retry |
| 4 | 7 days | 14 days | late retry |
| 5 (Final) | 7 days | 21 days | final retry |

**Error Classification**

Payment failures are classified into three categories:

**1. Retryable Errors (→ PAST_DUE)**
- `INSUFFICIENT_BALANCE`: User needs to add funds
- **Action**: Schedule retry, subscription status → PAST_DUE

**2. Terminal Errors (→ CANCELED)**
- `PERMISSION_EXPIRED`: Onchain permission expired
- `SUBSCRIPTION_NOT_ACTIVE`: Permission revoked by user
- **Action**: Mark subscription CANCELED, no further retries

**3. System Errors (→ keep ACTIVE)**
- `INTERNAL_ERROR`: Database failures, provider crashes, etc.
- **Action**: Keep subscription ACTIVE, create next order for recovery

**Retry Flow**

```
Payment Fails
    │
    ├─ Retryable? (INSUFFICIENT_BALANCE)
    │   ├─ Attempts < 4?
    │   │   ├─ Yes → Schedule retry (PAST_DUE)
    │   │   └─ No  → Mark UNPAID (max retries exhausted)
    │   │
    ├─ Terminal? (EXPIRED/REVOKED)
    │   └─ Mark CANCELED (no retries)
    │
    └─ System Error?
        └─ Keep ACTIVE (create next order)
```

### Queue Reliability

The backend uses **Cloudflare Queues** for asynchronous processing with built-in reliability features.

**Queue Architecture**

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Order Queue    │────▶│   Consumer   │────▶│   Order DLQ     │
│                 │     │  (3 retries) │     │  (system logs)  │
└─────────────────┘     └──────────────┘     └─────────────────┘

┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Webhook Queue   │────▶│   Consumer   │────▶│  Webhook DLQ    │
│                 │     │ (10 retries) │     │  (endpoint logs)│
└─────────────────┘     └──────────────┘     └─────────────────┘
```

**Queues & Retry Policies**

| Queue | Purpose | Max Retries | Retry Strategy | DLQ |
|-------|---------|-------------|----------------|-----|
| `order-queue` | Process subscription charges | 3 | Fixed 60s delay | `order-dlq` |
| `webhook-queue` | Deliver webhook events | 10 | Exponential backoff (5s-15min) | `webhook-dlq` |
| `order-dlq` | Log permanently failed orders | 0 | N/A | None |
| `webhook-dlq` | Log unreachable endpoints | 0 | N/A | None |

**Webhook Exponential Backoff:**
- Base delay: 5 seconds
- Max delay: 15 minutes
- Formula: `min(5s * 2^attempts, 900s)`
- Retry timeline: 5s → 10s → 20s → 40s → 80s → 160s → 320s → 15min (capped)
- **Total retry window: ~52 minutes**

**Note**: Payment failures are handled gracefully in `order.service.ts` with status updates and dunning retries. Messages reaching `order-dlq` indicate **system errors** (DB failures, crashes), not payment failures.

**Dead Letter Queues (DLQ)**

**Purpose**: Capture messages that fail after max retries for investigation

**Development**: DLQ consumers log failures with full context
- `order.dlq.consumer.ts`: Logs system errors during order processing
- `webhook.dlq.consumer.ts`: Logs permanently unreachable webhook endpoints

**Production Monitoring**: Use Cloudflare GraphQL Metrics API
- `outcome: dlq` - Messages sent to DLQ
- `backlogDepth` - DLQ message count
- `retryCount` - Total retry attempts
- `lagTime` - Message age in queue

### Webhook Events

All webhook events use the `subscription.updated` event type with conditional fields based on the event context.

**Event Structure**

```json
{
  "type": "subscription.updated",
  "created_at": 1234567890,
  "data": {
    "subscription": {
      "id": "0x1234...",
      "status": "active",
      "amount": "0.0001",
      "period_in_seconds": 60
    },
    "order": {
      "number": 2,
      "type": "recurring",
      "amount": "0.0001",
      "status": "paid",
      "current_period_start": 1234567890,
      "current_period_end": 1234567950,
      "next_retry_at": 1234740690
    },
    "transaction": {
      "hash": "0xabc...",
      "amount": "0.0001",
      "processed_at": 1234567890
    },
    "error": {
      "code": "INSUFFICIENT_BALANCE",
      "message": "User has insufficient balance..."
    }
  }
}
```

**Event Scenarios**

| Scenario | subscription | order | transaction | error |
|----------|--------------|-------|-------------|-------|
| Subscription created | ✓ | ✗ | ✗ | ✗ |
| Initial charge success | ✓ | ✓ | ✓ | ✗ |
| Initial charge failure | ✓ | ✗ | ✗ | ✓ |
| Recurring payment success | ✓ | ✓ | ✓ | ✗ |
| Recurring payment failure (retry scheduled) | ✓ | ✓ (with `next_retry_at`) | ✗ | ✓ |
| Max retries exhausted | ✓ | ✓ | ✗ | ✓ |

**Webhook Security**

- **Signature**: `X-Webhook-Signature: sha256=<hex>` header with HMAC-SHA256 of payload
- **Timestamp**: `X-Webhook-Timestamp: <unix>` header for replay attack prevention
- **Secret**: Returned from `PUT /api/webhook` endpoint (format: `whsec_<64_hex_chars>`)

**Verification Example**:
```typescript
const signature = req.headers['x-webhook-signature'].replace('sha256=', '')
const timestamp = req.headers['x-webhook-timestamp']
const payload = req.body  // Raw JSON string

const expectedSignature = crypto
  .createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex')

if (signature !== expectedSignature) {
  throw new Error('Invalid webhook signature')
}
```

## API Reference

**Base URL**: `http://localhost:3000/api`

### Endpoints

- **`GET /api/health`** - Health check
- **`PUT /api/account`** - Create account or rotate API key
  - **Requires**: `account_address`
  - **Returns**: `{ apiKey: string }`

- **`POST /api/subscriptions`** - Register subscription (bind onchain permission to infrastructure)
  - **Requires**: `Authorization: Bearer <api_key>` header
  - **Body**: `{ subscription_id: string, provider: "base" }`
  - **Returns**: Subscription details with initial transaction

- **`PUT /api/webhook`** - Set webhook URL for events
  - **Requires**: `Authorization: Bearer <api_key>` header
  - **Body**: `{ url: string }`
  - **Returns**: `{ url: string, secret: string }`

### Authentication

All endpoints (except `/health` and `/account`) require API key authentication:

```http
Authorization: Bearer <api_key>
```

API keys are obtained via `PUT /api/account` and are tied to a merchant account address.

## Database Schema

```sql
-- Core tables
accounts           -- Merchant accounts
api_keys           -- API key hashes
webhooks           -- Webhook configurations
subscriptions      -- Succesfully Registered Subscriptions (with provider_id)
orders             -- Payment orders
transactions       -- Blockchain transactions
```

## Development

### Testing Guide

**1. Setup Merchant Account**

1. Create an Account & Get API Key via `/api/account` endpoint
2. Set Webhook URL (Optional) via `/api/webhook` endpoint

**2a. Subscribe using the included playground app (Recommended)**

3. Set envs required for playground: `COUCH_API_KEY`, `COUCH_WEBHOOK_SECRET`
4. Open http://localhost:8000 in your browser and follow step to subscribe

**2b. Subscribe using the SDK directly**

3. `import { subscribe } from @base-org/account/payment`
4. Sign subscription `subscription_id = subscribe()` and register it via `api/subscriptions` endpoint with `provider: "base"`

**3. Process recurring orders**

5. Trigger order scheduler to process recurring payments via `http://localhost:3100/__scheduled`

### DEV Endpoints

- `GET http://localhost:3100/__scheduled` - Trigger order scheduler to process due recurring payments
- `GET http://localhost:3101/__scheduled` - Trigger dunning scheduler to process payment retries

**Playground App Proxy Routes** (with automatic auth injection):
- `/proxy/scheduled/order` → Routes to order-scheduler (port 3100)
- `/proxy/scheduled/dunning` → Routes to dunning-scheduler (port 3101)

**Note**: The playground app includes a settings UI to manually or automatically trigger these schedulers

### Monitoring

- Check Frontend webhook logs in the terminal
- Check Backend logs in the terminal
- Inspect sqlite DB file at `.alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject`

## Error Codes

**Request Errors:**
- `INVALID_REQUEST` - Missing required field
- `MISSING_FIELD` - Required field not provided
- `INVALID_FORMAT` - Invalid format (address, URL, subscription_id)

**Authentication Errors:**
- `UNAUTHORIZED` - Missing API key
- `INVALID_API_KEY` - Authentication failed
- `FORBIDDEN` - Not authorized to perform action

**Subscription/Payment Errors:**
- `SUBSCRIPTION_EXISTS` - Subscription already registered
- `SUBSCRIPTION_NOT_ACTIVE` - Subscription is not active
- `INSUFFICIENT_BALANCE` - User needs to add funds to activate subscription
- `PERMISSION_EXPIRED` - Onchain permission has expired
- `PAYMENT_FAILED` - Payment processing failed

**System Errors:**
- `INTERNAL_ERROR` - Internal server error

---

## DEV Resources

- [Postman Collection](./src/api/postman/collection.json) - Pre-configured collection with all endpoints, authentication, and examples.
