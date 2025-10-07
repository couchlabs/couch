# Couch Backend Service

A stablecoin subscription payment system built on Cloudflare Edge Infrastructure.

> **Getting Started**: See the [Getting Started guide](../../README.md#getting-started) in the main README for initial setup instructions.

## Subscription Lifecycle

**Initial Activation (First Charge):**

```
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │    Client    │─────▶│  Couch API   │─────▶│  Blockchain  │
  └──────────────┘      └──────────────┘      └──────────────┘
         │                      │                      │
         │ 1. Sign              │ 2. Initial           │ 3. Transfer
         │    Permission        │    Charge            │    USDC
         │                      │                      ▼
         │                      │              ┌──────────────┐
         │                      │              │   Merchant   │
         │                      │              │    Wallet    │
         │                      │              └──────────────┘
         │                      │ 4. Webhook
         │                      │    Event
         │                      ▼
         │               ┌──────────────┐
         │               │   Merchant   │
         │               │   Webhook    │
         │               └──────────────┘
```

**Recurring Payments (every 15 mins):**

```
  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
  │  Scheduler   │─────▶│    Queue     │─────▶│   Consumer   │
  └──────────────┘      └──────────────┘      └──────────────┘
         │                      │                     │
         │ Find due             │ Pass                │ Execute
         │ orders               │ orderId             │ charge
         ▼                      ▼                     ▼
  ┌──────────────┐                            ┌──────────────┐
  │   Database   │                            │  Blockchain  │
  └──────────────┘                            └──────────────┘
                                                      │
                                         ┌────────────┴────────────┐
                                         ▼                         ▼
                                  ┌──────────────┐         ┌──────────────┐
                                  │   Merchant   │         │   Merchant   │
                                  │    Wallet    │         │   Webhook    │
                                  └──────────────┘         └──────────────┘
```

## Project Structure

```
src/
├── api/              # HTTP API endpoints
│   ├── routes/       # Route handlers
│   └── middleware/   # Auth middleware
├── services/         # Business logic
├── repositories/     # Data access layer
├── providers/        # Onchain provider abstractions
├── consumers/        # Queue consumers
├── schedulers/       # Cron job schedulers
├── errors/           # Error handling
├── lib/              # Shared utils (ie logger)
├── constants/        # Shared constants
├── types/            # Infra types
└── alchemy.run.ts    # IaC configuration for provisioning and deploying the whole system
```

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

## API Endpoints

- `GET /api/health` - Health check
- `PUT /api/account` - Create account or rotate API key
  - Requires: `account_address`
- `POST /api/subscriptions` - Register subscription (Bind Onchain Permission to Offchain Infra)
  - Requires: `Authorization: Bearer <api_key>` header
  - Requires: `subscription_id`
  - Requires: `provider` (currently supports: "base")
- `PUT /api/webhook` - Set webhook URL for events
  - Requires: `Authorization: Bearer <api_key>` header
  - Requires: `url`

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

## Testing Guide

### 1. Setup Merchant Account

1. Create an Account & Get API Key via `/api/account` endpoint
2. Set Webhook URL (Optional) via `/api/webhook` endpoint

### 2a. Subscribe using the included demo app (Recommended)

3. Set envs required for demo: `COUCH_API_KEY`, `COUCH_WEBHOOK_SECRET`
4. Open http://localhost:8000 in your browser and follow step to subscribe

### 2b. Subscribe using the SDK directly

3. `import { subscribe } from @base-org/account/payment`
4. Sign subscription `subscription_id = subscribe()` and register it via `api/subscriptions` endpoint with `provider: "base"`

### 3. Process recurring orders

5. Trigger order scheduler to process recurring payments via `http://localhost:3100/__scheduled`

## Monitoring
- Check Frontend webhook logs in the terminal
- Check Backend logs in the terminal
- Inspect sqlite DB file at `.alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject`

## DEV Endpoints

- `GET http://localhost:3100/__scheduled` - Trigger order schedulers to process due recurring payments (Demo app include usufel setting UI to manually or automatically trigger)

## DEV Resources

- [Postman Collection](./src/api/postman/collection.json) - Pre-configured collection with all endpoints, authentication, and examples.