# Subscription Management API Specification

## Overview

REST API service for managing on-chain subscriptions using Cloudflare Workers, D1 database, and Workflows for scheduling recurring charges.

## API Endpoint

### Create Subscription

**POST** `/api/subscriptions`

Initiates the subscription setup process by starting a workflow that handles validation, charging, and activation.

#### Request Body

```json
{
  "subscription_id": "0x123..." // On-chain subscription ID (permission hash) - Required
}
```

#### Process Flow

1. Validate input (subscription_id is required)
2. Check if subscription already exists in database
3. Start SubscriptionSetup workflow for processing
4. Return immediate response (202 Accepted)

#### Response (202 Accepted)

```json
{
  "message": "Subscription setup initiated",
  "subscription_id": "0x123...",
  "status": "processing"
}
```

#### Error Responses

- `400 Bad Request` - Missing subscription_id
- `409 Conflict` - Subscription already exists (returns existing subscription data)

## Database Schema (D1)

### subscriptions table

```sql
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY,    -- On-chain subscription ID (also workflow ID)
  is_subscribed BOOLEAN NOT NULL,      -- Current on-chain subscription status
  billing_status TEXT NOT NULL,        -- Billing status: pending, active, failed
  recurring_charge TEXT NOT NULL,      -- Amount in USD (e.g., "9.99")
  period_days INTEGER,                 -- Billing period in days (nullable if not provided)
  next_charge_at DATETIME,              -- Next scheduled charge time
  last_charge_at DATETIME,              -- Last successful charge time
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Cloudflare Workflows

The system uses two workflows to manage subscriptions:

### 1. SubscriptionSetup Workflow

Handles the initial subscription creation, validation, and first charge.

#### Workflow ID Pattern

- `setup-{subscription_id}`

#### Workflow Steps

1. **validate_onchain**: Validates subscription status on-chain
   - Fetches subscription details from blockchain
   - Validates subscription is active
   - Ensures next period and charge amounts are valid
   - Throws NonRetryableError if validation fails

2. **create_db_record**: Creates database entry
   - Inserts subscription with `billing_status = 'pending'`
   - Stores recurring charge amount and period

3. **first_charge**: Processes initial payment
   - Attempts to charge the subscription
   - Returns success/failure status

4. **activate_subscription** OR **mark_failed**: Final status update
   - If charge successful:
     - Updates `billing_status = 'active'`
     - Sets `next_charge_at` and `last_charge_at`
     - Starts SubscriptionBilling workflow
   - If charge failed:
     - Updates `billing_status = 'failed'`
     - Throws NonRetryableError

### 2. SubscriptionBilling Workflow

Handles recurring charges after initial setup.

#### Workflow ID Pattern

- `{subscription_id}` (direct mapping)

#### Workflow Steps

1. **Sleep**: Wait until next charge time
   - Uses `step.sleep()` for durable pause

2. **Validate**: Check subscription still active on-chain
   - Verifies subscription hasn't been revoked

3. **Charge**: Process recurring payment
   - Attempts to charge the subscription

4. **Update**: Handle charge result
   - If successful: Schedule next charge, continue loop
   - If failed: Mark as failed, terminate workflow

5. **Loop**: Return to step 1 for continuous billing

#### On Failure

- Set `billing_status = 'failed'`
- Terminate the workflow
- Throw NonRetryableError

## Implementation Notes

### Workflow Management

#### SubscriptionSetup Workflow

- **Workflow ID**: `setup-{subscription_id}`
- **Triggered by**: API endpoint when new subscription is created
- **Single execution**: Runs once per subscription

```javascript
// Start setup workflow
await env.SUBSCRIPTION_SETUP.create({
  id: `setup-${subscriptionId}`,
  params: { subscriptionId },
})
```

#### SubscriptionBilling Workflow

- **Workflow ID**: `{subscription_id}` (direct mapping)
- **Triggered by**: SubscriptionSetup workflow after successful first charge
- **Continuous execution**: Loops indefinitely until terminated

```javascript
// Start billing workflow
await env.SUBSCRIPTION_BILLING.create({
  id: subscriptionId,
  params: { nextChargeAt },
})

// Terminate billing workflow
await env.SUBSCRIPTION_BILLING.get(subscriptionId).terminate()
```

### Status Management

- **is_subscribed**: On-chain subscription state (boolean)
- **billing_status**: Billing operations (pending, active, failed)
- Query billable: `WHERE is_subscribed = true AND billing_status = 'active'`

## Architecture Decisions for v0 POC

### Initial Charge Handling

For the v0 POC, the initial charge is processed in the SubscriptionSetup workflow. This approach was chosen for simplicity:

**Current Approach (v0 POC):**

- Initial charge happens in SubscriptionSetup workflow
- Setup either fully succeeds (subscription activated) or fails
- Failed setups require manual intervention
- Clear separation: Setup handles onboarding, Billing handles recurring only

**Future Enhancement (v1):**

- Consider moving initial charge to SubscriptionBilling workflow
- Would enable automatic retry of failed initial charges
- Provides unified payment handling and better recovery options
- Setup workflow would create subscription record and immediately start billing
- Billing workflow would detect first charge vs recurring charge

This architectural change is deferred to v1 to keep the POC simple and ship faster.

## Future Improvements

- **Unified Charge Handling**: Move initial charge to billing workflow for better retry capabilities
- **Webhook Support**: Add webhook endpoints for subscription status updates
- **Batch Processing**: Process multiple subscription charges in parallel
- **Monitoring Dashboard**: Real-time subscription status and billing metrics
- **Retry Strategies**: Configurable retry policies per subscription tier
- **Payment Method Fallbacks**: Try alternative payment methods on failure
- **Subscription Pausing**: Allow temporary subscription holds
- **Proration Support**: Handle mid-cycle subscription changes
- **Workflow Status API**: Endpoint to check workflow execution status
- **Idempotency Keys**: Prevent duplicate subscription creation attempts
- **Graceful Shutdown**: Handle subscription cancellations and refunds
- **Audit Logging**: Track all subscription state changes for compliance
- **Error Code System**: Centralized error codes and messages for better debugging
- **Validation Service**: Extract validation logic into reusable, testable service
