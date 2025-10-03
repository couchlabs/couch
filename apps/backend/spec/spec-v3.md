Webhhools notes

Our Current Webhook Payload:

  {
    "type": "subscription.updated",
    "created_at": 1759341605,
    "data": {
      "subscription": {
        "id": "0x...",
        "status": "active",  // or "inactive"
        "current_period_end": 1759341780  // Only on activation
      },
      "order": {
        "number": 2,
        "type": "initial|recurring",  // ✅ Can distinguish
        "amount": "0.0009",
        "status": "paid|failed"  // ✅ Can distinguish
      },
      "transaction": {
        "hash": "0x...",
        "amount": "0.0009",
        "processed_at": 1759341605
      }
    }
  }

  What Merchants CAN Distinguish:

  ✅ Initial vs Renewal
  - Check order.type: "initial" vs "recurring"

  ✅ Payment Success vs Failure
  - Check order.status: "paid" vs "failed"

  ✅ Active vs Inactive Subscription
  - Check subscription.status: "active" vs "inactive"

  What They CANNOT Distinguish:

  ❌ Why subscription became inactive
  - Was it payment failure? Cancellation? Expired?
  - We mark as "inactive" for any reason

  ❌ Temporary vs Permanent Failure
  - No retry count or "will retry" indicator

  ❌ When next charge will happen
  - current_period_end only sent on activation, not renewals

  ❌ Cancellation vs Immediate Stop
  - No "cancel_at_period_end" concept yet

  Quick Improvements for v1.5:

  1. Always include current_period_end (not just activation)
  2. Add order.failure_reason when status is "failed"
  3. Consider subscription.deactivation_reason: "payment_failed", "cancelled", "expired"

  These small additions would make the webhook much more useful without major changes!

NOTES:

  Today's Changes Summary

  1. Fixed transaction batching issue - Removed UNIQUE constraint on transaction_hash to support Base SDK's gas-efficient batching
  2. Simplified queue architecture - Reduced OrderQueueMessage from 7 fields to just 1 (orderId)
  3. Established single source of truth - Database is now the authoritative source, queue is just a notification
  4. Improved error handling - Made updateOrder throw on missing orders, ensuring orderNumber is always defined
  5. Maintained proper layering - Consumer → Service → Repository

  Suggested Audit Areas for Tomorrow

  When you review, here are key areas to audit for the reliability sprint:

  Edge Cases & Error Handling:
  - Partial failures in batch operations
  - Race conditions in concurrent order processing
  - Network timeouts during onchain operations
  - Database transaction rollback scenarios

  Reliability Features to Implement:
  - Retry logic with exponential backoff
  - Dead letter queues for failed messages
  - Circuit breakers for external services
  - Idempotency keys for duplicate prevention
  - Health checks and monitoring endpoints

  Code Simplification Opportunities:
  - Consolidate error handling patterns
  - Extract common webhook logic
  - Standardize logging format
  - Review if any more queue data can be removed

  Recovery Mechanisms:
  - Order reconciliation scheduled job
  - Stuck order detection and cleanup
  - Subscription state sync with onchain
  - Manual intervention tools




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
