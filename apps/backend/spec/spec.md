# Subscription Management API Specification

## Overview

REST API service for managing on-chain subscriptions using Cloudflare Workers, D1 database, and Workflows for scheduling recurring charges.

## API Endpoints

### 1. Create Subscription

**POST** `/api/subscriptions`

Creates a new subscription by validating an on-chain subscription ID and initiating the billing cycle.

#### Request Body

```json
{
  "subscription_id": "0x123..." // On-chain subscription ID (permission hash) - Required
}
```

#### Process Flow

1. Validate subscription exists on-chain and fetch details (amount, period_days, etc.)
2. Store in database with billing_status "pending"
3. Attempt first charge
4. If successful:
   - Update billing_status to "active"
   - Set next_charge_at to NOW() + period_days
   - Start workflow with subscription_id as workflow ID
5. Return subscription details

#### Response (201 Created)

```json
{
  "subscription_id": "0x123...",
  "status": "active", // On-chain status: active, revoked
  "billing_status": "active", // Billing status: pending, active, failed
  "owner_address": "0x456...",
  "payer_address": "0x789...",
  "recurring_charge": "9.99",
  "period_days": 30,
  "next_charge_at": "2024-02-15T10:00:00Z",
  "created_at": "2024-01-15T10:00:00Z"
}
```

#### Error Responses

- `400 Bad Request` - Any error (invalid ID, already exists, revoked, etc.)

### 2. Get Subscription Details

**GET** `/api/subscriptions/:subscription_id`

Retrieves detailed information about a subscription and current status.

#### Response (200 OK)

```json
{
  "subscription_id": "0x123...",
  "status": "active", // On-chain status: active, revoked
  "billing_status": "active", // Billing status: pending, active, failed
  "owner_address": "0x456...",
  "payer_address": "0x789...",
  "recurring_charge": "9.99",
  "period_days": 30,
  "next_charge_at": "2024-02-15T10:00:00Z",
  "created_at": "2024-01-15T10:00:00Z"
}
```

#### Error Responses

- `404 Not Found` - Subscription does not exist

## Database Schema (D1)

### subscriptions table

```sql
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY,    -- On-chain subscription ID
  workflow_id TEXT UNIQUE,             -- Cloudflare Workflow instance ID
  status TEXT NOT NULL,                -- On-chain status: active, revoked
  billing_status TEXT NOT NULL,        -- Billing status: pending, active, failed
  owner_address TEXT NOT NULL,         -- Address that receives payments
  payer_address TEXT NOT NULL,         -- Address that pays
  recurring_charge TEXT NOT NULL,      -- Amount in USD (e.g., "9.99")
  period_days INTEGER NOT NULL,        -- Billing period in days (from on-chain)
  next_charge_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Cloudflare Workflows

### Subscription Workflow

Handles the recurring billing cycle for each subscription.

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

- **Starting**: Use subscription_id as workflow ID for easy lookup
- **Stopping**: Store workflow_id in database to terminate when needed
- **Example**:

  ```javascript
  // Start workflow (period_days already fetched from on-chain)
  const workflowId = await env.WORKFLOW.create({
    id: subscription_id,
    params: { subscription_id },
  })

  // Terminate workflow
  await env.WORKFLOW.get(workflow_id).terminate()
  ```

### Status Management

- **status**: On-chain state (active, revoked)
- **billing_status**: Billing operations (pending, active, failed)
- Query billable: `WHERE status = 'active' AND billing_status = 'active'`
