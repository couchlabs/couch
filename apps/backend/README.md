# Couch Backend Service

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

Note: API accesses Blockchain directly for initial activation
      Order Processor handles recurring payments
      All components share the same D1 database
```

## API Overview (V1)

The V1 API provides the minimum viable functionality with just **3 endpoints**:

1. **Account Management** - Get API key
2. **Webhook Configuration** - Set webhook URL for events
3. **Subscription Activation** - Activate and process subscriptions

All subscription-related endpoints require authentication via API key.

## Testing Guide

### Step 1: Create an Account & Get API Key

First, you need to create an account to get an API key:

```bash
curl -X PUT http://localhost:3000/api/account \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0x123abc..."
  }'
```

Response:
```json
{
  "api_key": "ck_dev_456def..."  // Save this! Only shown once
}
```

> **Important**: Save the API key immediately. It's only shown once and cannot be retrieved later. You can rotate it by calling the same endpoint again.

### Step 2: Set Webhook URL (Optional)

Configure a webhook to receive subscription events:

```bash
curl -X PUT http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ck_dev_YOUR_API_KEY" \
  -d '{
    "url": "https://your-domain.com/webhooks/couch"
  }'
```

Response:
```json
{
  "secret": "whsec_abc123..."  // Use this to verify webhook signatures
}
```

### Step 3: Create a Test Subscription

#### Option A: Using the Frontend App (Recommended)

```bash
# Navigate to http://localhost:8000
# The frontend handles subscription creation automatically
# Clear localStorage to create new subscriptions
```

#### Option B: Using the SDK Directly

```javascript
import { subscribe } from "@base-org/account/payment"

const subscription = await subscribe({
  recurringCharge: "0.0009",
  subscriptionOwner: "0x...",  // Couch's smart wallet address
  periodInDays: 30,
  overridePeriodInSeconds: 60,  // 1-minute period for testing
  testnet: true,
})

console.log("Subscription ID:", subscription.id)
```

### Step 4: Activate the Subscription

Using the subscription ID from step 3:

```bash
curl -X POST http://localhost:3000/api/subscriptions \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ck_dev_YOUR_API_KEY" \
  -d '{
    "subscription_id": "0xa123..."
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

### Step 5: Trigger Scheduler Manually (Dev Only)

In development, trigger the scheduler manually:

```bash
curl http://localhost:3100/__scheduled
```

### Step 6: Monitor Recurring Payments

Watch the logs to see the complete flow:

```bash
# Scheduler finds due orders
INFO: Found 1 due orders
INFO: Sending order to queue

# Processor processes payment
INFO: Processing recurring payment
INFO: Onchain charge successful
INFO: Creating next order
```

## API Reference

### Postman Collection

📥 **[Import Collection](./src/api/postman/collection.json)** - Pre-configured collection with all endpoints, authentication, and examples.

### Endpoints

#### Health Check
```http
GET /api/health
```
Returns API health status.

#### Create/Rotate Account API Key
```http
PUT /api/account
Content-Type: application/json

{
  "address": "0x..."  // Your EVM address
}
```

Returns:
```json
{
  "api_key": "ck_{stage}_..."  // Full API key - save it!
}
```

**API Key Format:**
- `ck_dev_...` - Development
- `ck_staging_...` - Staging
- `ck_sandbox_...` - Sandbox
- `ck_prod_...` - Production

#### Set Webhook URL
```http
PUT /api/webhook
Content-Type: application/json
X-API-Key: ck_dev_...

{
  "url": "https://your-domain.com/webhooks"
}
```

Returns:
```json
{
  "secret": "whsec_..."  // HMAC secret for signature verification
}
```

#### Activate Subscription
```http
POST /api/subscriptions
Content-Type: application/json
X-API-Key: ck_dev_...

{
  "subscription_id": "0x..."
}
```

Returns subscription details and transaction hash.

## Project Structure

```
src/
├── api/              # HTTP API endpoints
│   ├── routes/       # Route handlers
│   └── middleware/   # Auth middleware
├── constants/        # Shared constants
│   ├── env.constants.ts
│   └── subscription.constants.ts
├── errors/           # Error handling
│   ├── http.errors.ts
│   └── subscription.errors.ts
├── services/         # Business logic
├── repositories/     # Data access layer
├── consumers/        # Queue consumers
└── schedulers/       # Cron job schedulers
```

## Database Schema

```sql
-- Core tables
accounts            -- Merchant accounts
api_keys           -- API key hashes
webhooks           -- Webhook configurations
subscriptions      -- Active subscriptions
orders             -- Payment orders
transactions       -- Blockchain transactions
```

## Error Codes

The API uses consistent error codes:

- `INVALID_REQUEST` - Invalid request format
- `INVALID_API_KEY` - Authentication failed
- `NOT_FOUND` - Resource not found
- `SUBSCRIPTION_EXISTS` - Subscription already activated
- `INSUFFICIENT_BALANCE` - User needs to add funds
- `PAYMENT_FAILED` - Payment processing failed

## Development Tools

### Database Inspection

```bash
# Find your database file
ls ../../.alchemy/miniflare/v3/d1/miniflare-D1DatabaseObject/

# Query subscriptions
sqlite3 <path-to-db> "SELECT * FROM subscriptions"

# Query orders
sqlite3 <path-to-db> "SELECT id, status, due_at FROM orders"

# Query accounts
sqlite3 <path-to-db> "SELECT * FROM accounts"
```

### Logs

Development logs appear in the terminal. Key events to watch:

- Account creation: `"Account API key rotated successfully"`
- Webhook set: `"Webhook URL set successfully"`
- Subscription activation: `"Subscription activated"`
- Order processing: `"Processing recurring payment"`
- Charge success: `"Onchain charge successful"`

## Environment Variables

Required environment variables (see `.env.example`):

```env
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
CDP_WALLET_NAME=
CDP_PAYMASTER_URL=
```

## Troubleshooting

### Common Issues

1. **"Invalid API key"**
   - Ensure you're using the correct API key from step 1
   - Check the X-API-Key header format

2. **"Subscription already exists"**
   - The subscription was already activated
   - Use a new subscription ID

3. **"Webhook URL must use HTTPS"**
   - Use HTTPS URLs (except localhost for development)

4. **Payment failures**
   - Check user's USDC balance
   - Verify spend permission is active
   - Ensure CDP credentials are correct

## Future Enhancements (V2+)

Coming in future versions:

- **Account Management**: Signature verification, multiple API keys
- **Webhook Management**: GET/DELETE endpoints, multiple webhooks
- **Enhanced Events**: More granular event types
- **Monitoring**: Webhook delivery tracking, retry logic
- **Security**: Rate limiting, usage analytics