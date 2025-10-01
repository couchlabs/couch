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
  │  Scheduler   │─────▶│    Queue     │─────▶│  Processor   │
  └──────────────┘      └──────────────┘      └──────────────┘
         │                      │                     │
         │ Find due             │ Pass                │ Charge via
         │ orders               │ orderId             │ Blockchain
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

## API Endpoints

- `GET /api/health` - Health check
- `PUT /api/account` - Create account or rotate API key
- `POST /api/subscriptions` - Register subscription (Bind Onchain Permission to Offchain Infra)
- `PUT /api/webhook` - Set webhook URL for events

#### Error Codes

- `INVALID_REQUEST` - Invalid request format
- `INVALID_API_KEY` - Authentication failed
- `NOT_FOUND` - Resource not found
- `SUBSCRIPTION_EXISTS` - Subscription already registered
- `INSUFFICIENT_BALANCE` - User needs to add funds to be able to Activate Subscription and process first charge
- `PAYMENT_FAILED` - Payment processing failed

#### DEV Endpoints

- `GET http://localhost:3100/__scheduled` - Trigger order schedulers to process due recurring payments

#### DEV Resources

- [Postman Collection](./src/api/postman/collection.json) - Pre-configured collection with all endpoints, authentication, and examples.


## Project Structure

```
src/
├── api/              # HTTP API endpoints
│   ├── routes/       # Route handlers
│   └── middleware/   # Auth middleware
├── services/         # Business logic
├── repositories/     # Data access layer
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
subscriptions      -- Succesfully Registered Subscriptions
orders             -- Payment orders
transactions       -- Blockchain transactions
```


## Testing Guide

**1. Setup Merchant Account**
  
1. Create an Account & Get API Key via `/api/account` endpoint
2. Set Webhook URL (Optional) via `/api/webhook` endpoint

**2a. Subscribe using the included frontend app (Recommended)**

3. Set Frontend demo app envs: `COUCH_API_KEY`, `COUCH_WEBHOOK_SECRET`
4. Open http://localhost:8000 in your browser and follow step to susbcribe 

**2b. Subscribe using the SDK directly**

3. `import { subscribe } from @base-org/account/payment`
4. Sign subscription `subscription_id = subscribe()`
5. Register subscription in couch via `api/subscriptions` endpoint

#### Monitoring
- Check Frontend webhook logs in the terminal
- Check Backend logs in the terminal
- Inspect sqlite DB file at `.alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject`
