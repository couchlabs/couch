# Subscription Management API Specification

## Overview

REST API service for managing on-chain subscriptions using Cloudflare Workers, D1 database, and Workflows for scheduling recurring charges.

## API Endpoint

### Create Subscription

**POST** `/api/subscriptions`

Creates a new subscription by validating an on-chain subscription ID and initiating the billing cycle.

#### Request Body

```json
{
  "subscription_id": "0x123..." // On-chain subscription ID (permission hash) - Required
}
```

#### Process Flow (API Endpoint)

1. Validate subscription exists on-chain and fetch details (amount, period_days, etc.)
2. Store in database with billing_status "pending"
3. Attempt first charge
4. If successful:
   - Update billing_status to "active"
   - Set next_charge_at to NOW() + period_days
   - Start workflow with subscription_id as workflow ID (for future charges)
5. Return subscription details

Note: The API handles initial setup and first charge. The workflow only handles recurring charges.

#### Response (201 Created)

```json
{
  "subscription_id": "0x123...",
  "is_subscribed": true, // Current on-chain subscription status
  "billing_status": "active", // Billing status: pending, active, failed
  "recurring_charge": "9.99",
  "period_days": 30,
  "next_charge_at": "2024-02-15T10:00:00Z",
  "created_at": "2024-01-15T10:00:00Z"
}
```

#### Error Responses

- `400 Bad Request` - Any error (invalid ID, already exists, revoked, etc.)

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

### Subscription Workflow

Handles the recurring billing cycle for each subscription (after the first charge is done by the API).

#### How It Works

- **One workflow per subscription**: Started via `env.WORKFLOW.create()` with subscription_id as workflow ID
- **Durable sleep**: Uses `step.sleep()` to pause until next billing period
- **Continuous loop**: Same workflow instance continues after sleep
- **Termination**: Call `env.WORKFLOW.get(workflow_id).terminate()` when subscription is cancelled/failed

#### Workflow Steps

1. **Validate**: Check subscription status on-chain (already has period_days from initial setup)
2. **Charge**: Attempt to charge the subscription
3. **Update**: Update database with charge result and next_charge_at
4. **Sleep**: Durable sleep until next_charge_at
5. **Wake & Loop**: Same workflow instance wakes up and returns to step 1

#### On Failure

- Set billing_status to "failed"
- Terminate the workflow
- No retries for POC

## Implementation Notes

### Workflow Management

- **Workflow ID = Subscription ID**: Use subscription_id as the workflow ID for direct lookup
- **No separate ID needed**: The subscription_id serves as both database key and workflow identifier
- **Example**:

  ```javascript
  // Start workflow (using subscription_id as the workflow ID)
  await env.WORKFLOW.create({
    id: subscription_id,
    params: { subscription_id },
  })

  // Terminate workflow (using subscription_id)
  await env.WORKFLOW.get(subscription_id).terminate()
  ```

### Status Management

- **is_subscribed**: On-chain subscription state (boolean)
- **billing_status**: Billing operations (pending, active, failed)
- Query billable: `WHERE is_subscribed = true AND billing_status = 'active'`

## Future Improvements

### 1. Workflow-Based Subscription Setup

Currently, the initial subscription setup (validation, first charge, activation) is handled in the API endpoint. This can lead to partial states if any step fails. A better approach would be to use a workflow for the entire setup process.

#### Proposed Architecture

**Two Workflow System:**

1. **SubscriptionSetup Workflow** (new) - Handles initial subscription creation
2. **SubscriptionBilling Workflow** (existing) - Handles recurring charges

#### SubscriptionSetup Workflow Steps

```typescript
export class SubscriptionSetup extends WorkflowEntrypoint {
  async run(event, step) {
    const { subscriptionId } = event.payload

    // Step 1: Validate on-chain subscription status
    const status = await step.do("validate_onchain", async () => {
      return await base.subscription.getStatus({
        id: subscriptionId,
        testnet: true,
      })
      // Automatic retries if blockchain is temporarily unavailable
    })

    // Step 2: Create database record
    await step.do("create_db_record", async () => {
      // Insert subscription with 'pending' status
      // Idempotent - won't duplicate if retried
    })

    // Step 3: Process first charge
    const chargeResult = await step.do("first_charge", async () => {
      return await base.subscription.charge({
        id: subscriptionId,
        amount: status.remainingChargeInPeriod,
        // ... payment credentials
      })
      // Automatic retries with exponential backoff
    })

    // Step 4: Activate subscription
    if (chargeResult.success) {
      await step.do("activate_subscription", async () => {
        // Update DB status to 'active'
        // Start recurring billing workflow
        await env.SUBSCRIPTION_BILLING.create({
          id: subscriptionId,
          params: { nextChargeAt: status.nextPeriodStart },
        })
      })
    } else {
      await step.do("mark_failed", async () => {
        // Update DB status to 'failed'
      })
    }
  }
}
```

#### Simplified API Endpoint

```typescript
app.post("/api/subscriptions", async (c) => {
  const subscriptionId = body?.subscription_id

  if (!subscriptionId) {
    return c.json({ error: "subscription_id is required" }, 400)
  }

  // Check if already exists
  const existing = await c.env.SUBSCRIPTIONS.prepare(
    "SELECT * FROM subscriptions WHERE subscription_id = ?",
  )
    .bind(subscriptionId)
    .first()

  if (existing) {
    return c.json(
      {
        error: "Subscription already exists",
        subscription: existing,
      },
      409,
    )
  }

  // Start setup workflow
  await c.env.SUBSCRIPTION_SETUP.create({
    id: `setup_${subscriptionId}`,
    params: { subscriptionId },
  })

  return c.json(
    {
      message: "Subscription setup initiated",
      subscription_id: subscriptionId,
      status: "processing",
    },
    202,
  ) // 202 Accepted
})
```

#### Benefits

1. **Automatic Retries**: Each step can be retried independently with configurable retry policies
2. **State Persistence**: Workflow state is durable - if a step fails, it resumes from that exact point
3. **No Partial States**: Eliminates issues like "charge succeeded but workflow creation failed"
4. **Better Observability**: Each step is tracked in workflow history for debugging
5. **Idempotency**: Steps are automatically idempotent, preventing duplicate charges
6. **Error Recovery**: Failed workflows can be inspected and potentially resumed

#### Migration Strategy

1. Implement new `SubscriptionSetup` workflow alongside existing code
2. Add feature flag to route traffic between implementations
3. Test with small percentage of traffic
4. Gradually increase traffic to new implementation
5. Remove old implementation once stable

### 2. Additional Improvements

- **Webhook Support**: Add webhook endpoints for subscription status updates
- **Batch Processing**: Process multiple subscription charges in parallel
- **Monitoring Dashboard**: Real-time subscription status and billing metrics
- **Retry Strategies**: Configurable retry policies per subscription tier
- **Payment Method Fallbacks**: Try alternative payment methods on failure
- **Subscription Pausing**: Allow temporary subscription holds
- **Proration Support**: Handle mid-cycle subscription changes
