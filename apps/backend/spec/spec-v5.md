# Couch v5 - Frontend Architecture Spec

## Overview
Minimal, interactive subscription testing interface for creating and managing subscriptions with real-time status.

## Core Features

### 1. Subscription Creator
Simple, conversational UI to configure subscription:
- **Charge**: Amount input (e.g., 0.001, 0.01, 1.0 USDC)
- **Every**: Number + unit dropdown (seconds, minutes, hours, days)
- **Subscribe Button**: Creates subscription with current parameters
Layout: on top of left column of the ui

### 2. Subscription List
Dynamic list showing all created subscriptions:
- **Status Indicator** (Couch backend status) - see styling details
- **Basic Info**: Amount, period, subscription ID (truncated)
- **Selection**: Click row to show details in right column
Layout: 
- left column (below Subscription Creator)
- If no subscription yet, have an empty state element


### 3. Subscription Details Panel
When subscription row is selected:

#### Status Section (Always visible)
- **Couch Status**: active/inactive/processing (from backend)
- **Onchain Status**: Expandable - fetches live data when expanded
  - When collapsed: Shows "Check onchain status ▼"
  - When expanded: Fetches and shows getSubscriptionStatus() data
    - Is subscribed (true/false)
    - Owner address
    - Spender address
    - Remaining charge in period
    - Next period start
    - Recurring charge amount

#### Webhook Events (Always visible)
List of events ordered newest first:
- Each event shows summary: type, time, status
- Each event is expandable to show full JSON payload
- If no event yet, have an empty state element

Note: Onchain data is fetched on-demand only when user expands that section

## User Flow

```
1. User configures subscription
   ├── Sets price (e.g., 0.01 USDC)
   └── Sets period (e.g., 30 seconds)

2. Clicks "Subscribe"
   ├── Calls Base SDK createSubscription()
   └── Then calls backend POST /api/subscriptions to activate

   Note: Future Couch SDK will wrap both steps into single checkout() method,
   but MVP explicitly shows both steps to test the integration 

3. Subscription appears in list
   ├── Shows with blinking yellow dot (processing)
   ├── Updates to green (webhook confirmed) or red (backend error/webhook failed)
   └── Auto-selects to show details in right panel
       └── If still processing: Shows "Activating subscription..." with spinner
       └── Once webhook arrives: Shows full details 

4. User can check status
   ├── Click "Check Onchain Status"
   ├── Calls Base SDK getSubscriptionStatus()
   └── Updates UI with latest data
```

## Component Structure

```
<App>
  <LeftColumn>
    <SubscriptionCreator>
      <PriceInput />
      <PeriodSelector />
      <SubscribeButton />
    </SubscriptionCreator>
    <SubscriptionList>
      <SubscriptionRow> // Clickable
        <StatusDot />
        <BasicInfo />
      </SubscriptionRow>
      ...
    </SubscriptionList>
  </LeftColumn>

  <RightColumn>
    <ExpandedDetails> // Shows on click
      <CouchStatus />
      <OnchainStatusExpandable />
      <CouchEventLists>
        <WebhookEventExpandable />
        ...
      </CouchEventLists>
    </ExpandedDetails>
  </RightColumn>
</App>
```

## Technical Implementation

### State Management
```typescript
interface AppState {
  // Creator state
  price: string
  periodValue: number
  periodUnit: 'seconds' | 'minutes' | 'hours' | 'days'

  // Subscriptions
  subscriptions: Subscription[]
  selectedSubscriptionId: string | null
}

interface Subscription {
  id: string
  status: 'processing' | 'active' | 'failed'
  amount: string
  period: number // in seconds
  details?: SubscriptionDetails
  error?: string
  createdAt: Date
}
```

### API Integration
```typescript
// Creating subscription and activating/registering via couch
// Couch SDK methods:
async function checkout() {
  // 1. Create onchain with Base SDK
  const subscription = await baseSDK.createSubscription({
    productId: 'dynamic',
    chargeAmount: parseUnits(price, 6), // USDC decimals
    chargePeriod: convertToSeconds(periodValue, periodUnit)
  })

  // 2. Activate via backend
  await fetch('/proxy/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      subscription_id: subscription.id,
      provider: 'base'
    })
  })
}

// Checking status
async function checkOnchainStatus(subscriptionId: string) {
  const status = await baseSDK.getSubscriptionStatus(subscriptionId)
  // Update local state with fresh data
}
```

Notes: 
- in the future we might want to move checkOnchainStatus via our backend, where we can use the relative provider and potentially mark our subscription inactive if onchain permission was revoked
- we might also want to support externalId, so that marchant can pass externalId for their user in case they have it, so that they can query using their own ids, polar has this very smart feature, we should borrow it


## UI/UX Design
- leverate shadcn for components and system
- tailwindcss for css
- and the following theme https://v0.app/templates/sketchpad-shadcn-ui-theme-rINMO44ZAoN?utm_source=affiliate&utm_medium=dub&via=sketchpad-theme&dub_id=tIEdS0ledyylqaCj
### Visual Design
- **Clean & Minimal**: Focus on functionality
- **Real-time Feedback**: Loading states, status updates
- **icon Coding**:
  - check icon: Active/Success
  - spinner icon: Processing/Pending
  - x icon: Failed/Error
  - empty circle: Inactive

### Layout
```
┌──────────────────────────────┬────────────────────────────────────┐
│      Subscriptions           │            Details                 │
├──────────────────────────────┼────────────────────────────────────┤
│ ┌──────────────────────────┐ │                                    │
│ │  Create Subscription     │ │                                    │
│ │ Charge: [0.01] USDC      │ │                                    │
│ │ Every: [30] [seconds ▼]  │ │     Select a subscription         │
│ │ [    Subscribe    ]      │ │       to view details             │
│ └──────────────────────────┘ │                                    │
│                              │                                    │
│ ─────────────────────────    │                                    │
│                              │                                    │
│ ● 0x1234...5678             │                                    │
│   0.01 USDC every 30s       │                                    │
│                              │                                    │
│ ● 0x5678...9abc             │                                    │
│   1.00 USDC every 1d        │                                    │
│                              │                                    │
│ ○ 0xabcd...ef01             │                                    │
│   0.001 USDC every 5m       │                                    │
│   Creating...               │                                    │
└──────────────────────────────┴────────────────────────────────────┘

When subscription selected:
┌──────────────────────────────┬────────────────────────────────────┐
│      Subscriptions           │         0x1234...5678              │
├──────────────────────────────┼────────────────────────────────────┤
│ ┌──────────────────────────┐ │         0x1234...5678              │
│ │  Create Subscription     │ │ ────────────────────────────────   │
│ │ Charge: [0.01] USDC      │ │                                    │
│ │ Every: [30] [seconds ▼]  │ │ Couch Status: ● active             │
│ │ [    Subscribe    ]      │ │ ▼ Check onchain status             │
│ └──────────────────────────┘ │                                    │
│                              │ ─────────────────────────────────  │
│ ─────────────────────────    │ WEBHOOK EVENTS                     │
│                              │                                    │
│ ▶ 0x1234...5678  [selected] │ ▼ subscription.updated (2m ago)    │
│   0.01 USDC every 30s       │   Order #5 paid                    │
│                              │                                    │
│ ● 0x5678...9abc             │ ▼ subscription.updated (32m ago)   │
│   1.00 USDC every 1d        │   Order #4 paid                    │
│                              │                                    │
│                              │ ▼ subscription.updated (1h ago)    │
│                              │   Order #3 paid                    │
│                              │                                    │
│                              │ When event expanded:                │
│                              │ ▲ subscription.updated (2m ago)    │
│                              │   Order #5 paid                    │
│                              │   {                                │
│                              │     "type": "subscription.updated",│
│                              │     "data": { ... }                │
│                              │   }                                │
└──────────────────────────────┴────────────────────────────────────┘
```

Subscription List card examples:
```
Active subscription:
┌─────────────────────────────────────────────────────────────┐
│  ✓  0x1234...5678                                           │
│     0.01 USDC every 30 seconds                              │
└─────────────────────────────────────────────────────────────┘

Processing subscription:
┌─────────────────────────────────────────────────────────────┐
│  ⟳  0x5678...9abc                                           │
│     1.00 USDC every 1 day                                   │
└─────────────────────────────────────────────────────────────┘

Failed subscription:
┌─────────────────────────────────────────────────────────────┐
│  ✗  0xabcd...ef01                                           │
│     0.001 USDC every 5 minutes                              │
└─────────────────────────────────────────────────────────────┘

Selected/hover state - Same as other, just with different visual accent based on theme
```
Subscription Details (Couch Backend):
```
┌─────────────────────────────────────────────────────────────┐
│  COUCH BACKEND STATUS                                       │
│  ─────────────────────────────────────────────────────────  │
│  Subscription ID: 0x1234567890abcdef1234567890abcdef        │
│  Status: Active                                             │
│  Initial Transaction: 0xabc123...def456                     │
│  Next Order Date: 2024-01-15 10:45:30                       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  ONCHAIN STATUS                                          ▼  │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  WEBHOOK EVENTS                                             │
│  ─────────────────────────────────────────────────────────  │
│  ✓ Subscription reactivated                   1m ago  -  ▼  │
│  ✓ Payment successful - 3rd attempt           2m ago  -  ▼  │
│  ✗ Subscription deactivated                   1h ago  -  ▼  │
│  ✗ Payment failed - 2nd attempt              32m ago  -  ▼  │
│  ✗ Payment failed - 1st attempt              52m ago  -  ▼  │
│  ✓ Subscription activated                     1h ago  -  ▼  │
└─────────────────────────────────────────────────────────────┘
```


## Execution plan

### Phase 0: Scaffholding & Wiring
- [x] Alchemy.run setup (D1)
- [x] Frontend setup with clean empty entry point fully wired and setup
  - Hello world with react query work (ie on proxy/...health)
  - Shadcn configured
  - Components/Theme correctly setup
  - Database exposed to worker

### Phase 1: Core Functionality
- [x] Subscription creator UI
- [x] Basic subscription list
- [x] Create subscription flow
- [x] Status indicators
- [x] Expandable details

### Phase 2: Enhanced Features
- [x] Onchain status checking -> this can happen in the client for now, using base account getSubscriptionStatus 


### Phase 3: Polish
- [x] Add poller on _scheduled on backend to trigger order scheduler
- [x] Fine tune design/layout/appearance
- [ ] Move base+call to backend into couch-sdk package
- [ ] Loading states 
- [ ] Error handling
- [ ] List findings and learnings, what we need in mvp into couch backend? anything we need to cleanup 

## State Management

### Simple D1 Database Architecture
Using Cloudflare D1 database in the frontend worker for subscription state persistence:

```sql
-- Subscriptions table (minimal - only backend response data)
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,              -- subscription hash
  status TEXT NOT NULL,             -- 'processing', 'active', 'failed'
  transaction_hash TEXT,            -- from activation response
  next_order_date TEXT,             -- from activation response
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Note: Intentionally not storing user input (amount, period) to identify what backend API should return

-- Webhook events table
CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,        -- JSON blob
  created_at TEXT NOT NULL,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);
```

### Frontend Worker Endpoints

```typescript
// Worker endpoints
GET  /api/subscriptions              // List all subscriptions
GET  /api/subscriptions/:id          // Get subscription details
GET  /api/subscriptions/:id/events   // Get webhook events
POST /api/webhook                    // Receive and store webhook

// Proxy to backend (already exists)
POST /proxy/api/subscriptions        // Activate subscription (goes to backend)
```

### Data Flow with D1

```
1. Frontend creates subscription
   ├── Base SDK: subscribe() → returns ID
   ├── Backend: POST /proxy/api/subscriptions → returns tx hash
   └── First webhook creates record in D1

2. Backend sends webhook
   ├── Backend: Process payment
   ├── Backend: Queue webhook delivery
   └── Frontend Worker: POST /api/webhook
       └── Insert/update subscription in D1
       └── Store event in webhook_events

3. Frontend polls for updates
   ├── Poll GET /api/subscriptions every 2-3 seconds (always)
   ├── Poll GET /api/subscriptions/:id/events (only when selected)
   └── Update UI with latest data
```

### Why This Architecture

- **Simple & Boring**: Just SQL queries, no complexity
- **Persistent**: Data survives worker restarts
- **Queryable**: Can filter, sort, aggregate with SQL
- **Familiar**: Standard REST + polling pattern
- **Cost Effective**: D1 is cheap, no DO overhead
- **Easy Testing**: Can query DB directly

## Tech Stack
- **React + Vite**: Fast development
- **TypeScript**: Type safety
- **Tailwind CSS**: Quick styling
- **Shadcn/ui**: Component library
- **Base Account SDK**: Blockchain interaction
- **Cloudflare D1**: Database for state persistence
- **React Query**: Handle polling and caching
- **Alchemy**: IaC for configuration

## Implementation Findings & Learnings

### Display Data Requirements
**Finding:** Subscription cards need to show "0.01 USDC every 30 seconds" but this data isn't stored in D1

**Options:**
1. **Backend API Enhancement** (Recommended)
   - Add `amount` and `period_seconds` to POST `/api/subscriptions` response
   - Store in D1 subscriptions table for quick display
   - Pros: Fast, no additional API calls
   - Cons: Requires D1 schema update

2. **From Webhook Events** (Partial)
   - Webhook contains `order.amount` but missing period info
   - Would need backend to include period in webhook payload
   - Pros: Automatic updates via webhooks
   - Cons: Incomplete data without backend changes

3. **Onchain Verification** (Expensive)
   - Call `base.subscription.getStatus()` for each subscription
   - Returns allowance and period from blockchain
   - Pros: Always accurate, source of truth
   - Cons: Expensive RPC calls, slow for lists

**Recommendation:** Update backend to return subscription amount + period, store in D1, and use onchain calls only for verification/detail views

### Webhook Event Display & Retry Tracking
**Finding:** Cannot easily track payment retry attempts without complex state management

**Current Implementation:**
- Initial payment: Uses `order.type === 'initial'` → "Subscription activated"
- Recurring payments: "Payment successful" / "Payment failed" (no attempt number)
- Compact single-line format with timestamp on right

**Data Available in Webhook:**
```json
"order": {
  "number": 1,           // Incremental order number for this subscription (1, 2, 3...)
  "type": "initial",     // "initial" for first charge, "recurring" for all subsequent
  "amount": "0.0001",
  "status": "paid"       // "paid" or "failed"
}
```

**Limitation:**
- `order.type` only distinguishes "initial" (first charge) vs "recurring" (any subsequent charge)
- `order.number` increments globally per subscription, NOT per payment attempt
- Cannot determine which retry attempt (1st, 2nd, 3rd) without tracking state across events
- Example: Order #2 failed, #3 failed, #4 succeeded - no way to know #4 was the "3rd attempt"

**Possible Solutions:**
1. Backend includes `retry_attempt` in webhook payload
2. Frontend tracks payment attempts in D1 by grouping failed/succeeded events
3. Accept limitation and show simple "Payment successful/failed" without attempt numbers

### Error Handling & Display
**Finding:** When subscription activation fails (e.g., insufficient balance), error information exists in backend but is not displayed in frontend subscription details.

**Current Behavior:**
- Backend properly detects errors (e.g., `INSUFFICIENT_BALANCE`)
- Backend marks subscription as inactive and logs error details
- Frontend shows error in browser alert during creation
- Frontend does NOT show error when viewing subscription details later

**Problem:**
- User sees error once during creation, but error disappears after dismissing alert
- When viewing subscription list/details, inactive subscriptions show no explanation for why they're inactive
- No way to see error history or troubleshoot failed subscriptions

**Data Available:**
```json
// Backend logs show:
{
  "subscriptionId": "0x...",
  "errorCode": "INSUFFICIENT_BALANCE",
  "orderId": 37,
  "error": "Insufficient balance to complete payment"
}
```

**Possible Solutions:**
1. **Add error field to subscription API response**
   - Include `error`, `errorCode`, and `failedAt` in GET `/api/subscriptions/:id`
   - Display in subscription details panel below status
   - Pros: Simple, no schema changes needed if backend already stores it
   - Cons: Only shows last error

2. **Store errors in D1 via webhook events**
   - Backend webhook includes error details when status changes to inactive
   - Frontend stores in D1 and displays in details panel
   - Pros: Persistent history, works with existing webhook flow
   - Cons: Requires webhook payload enhancement

3. **Add dedicated errors section to subscription details**
   - Show all failed activation/payment attempts with timestamps
   - Link to relevant order IDs for debugging
   - Pros: Complete error history, better debugging
   - Cons: More complex UI and data model

**Recommendation:** Start with option 1 (include error in API response) for MVP, then consider option 3 for better error visibility and debugging in production.

### Error Details in Webhook Payloads
**Finding:** When payment failures occur, the backend logs contain detailed error information that would be valuable in webhook payloads.

**Current Behavior:**
- Backend detects specific error conditions (e.g., "Spend permission has been revoked")
- Webhook includes generic error code: `"payment_failed"`
- Detailed error message only in backend logs, not in webhook

**Example from Testing:**
```json
// Backend logs show:
"Spend permission has been revoked"

// Webhook payload shows:
{
  "error": {
    "code": "payment_failed",
    "message": "PAYMENT_FAILED"
  }
}
```

**Problem:**
- Merchants receive webhook but don't know *why* payment failed
- Need to check backend logs or make additional API calls to understand issue
- Cannot provide specific user guidance (e.g., "Permission revoked" vs "Insufficient balance")
- Harder to build appropriate UI responses to different error types

**Proposed Enhancement:**
Include detailed error reason in webhook payload:
```json
{
  "error": {
    "code": "payment_failed",
    "message": "PAYMENT_FAILED",
    "reason": "Spend permission has been revoked"  // Add this field
  }
}
```

**Benefits:**
1. **Better UX**: Merchants can show specific error messages to users
2. **Debugging**: Clear error context without checking logs
3. **Automation**: Enable different handling for different error types
4. **Transparency**: Full visibility into why payments fail

**Error Reasons to Include:**
- "Spend permission has been revoked"
- "Insufficient balance to complete payment"
- "Subscription period not yet elapsed"
- Any other onchain/provider errors

**Recommendation:** Add `reason` field to error object in webhook payload containing the detailed error message from backend processing.

### Onchain Status Display for Revoked Subscriptions
**Finding:** When a subscription is revoked, `getSubscriptionStatus` returns invalid/max values for certain fields.

**Current Behavior:**
When `isSubscribed: false` (subscription revoked), the onchain data shows:
```
Is Subscribed: No
Owner: 0x3f38256ba86c39d7ecf9972c9497587530ea1c56
Remaining Charge in Period: 0.0001 USDC
Next Period Start: 7/1/57725, 8:36:40 AM  ← Invalid far-future date
Recurring Charge: 0.0001 USDC
```

**Problem:**
- `nextPeriodStart` shows year 57725 (probably max uint timestamp)
- Displaying these values when subscription is revoked is misleading
- Other fields may also contain invalid/default values
- Creates confusion about subscription state

**Proposed Solutions:**

**Option 1: Hide fields when isSubscribed is false**
```
Is Subscribed: No
Owner: 0x3f38256ba86c39d7ecf9972c9497587530ea1c56
// Don't show remaining charge, next period, recurring charge when revoked
```

**Option 2: Show with clear "N/A" or disabled state**
```
Is Subscribed: No
Owner: 0x3f38256ba86c39d7ecf9972c9497587530ea1c56
Remaining Charge in Period: N/A (subscription revoked)
Next Period Start: N/A (subscription revoked)
Recurring Charge: 0.0001 USDC
```

**Option 3: Show different UI entirely**
```
Is Subscribed: No
Owner: 0x3f38256ba86c39d7ecf9972c9497587530ea1c56
Status: This subscription permission has been revoked
```

**Recommendation:** Use Option 1 - conditionally hide fields that don't make sense when subscription is not active. Only show `isSubscribed` and `owner` when revoked.

### Subscription Creation Flow - UX Timing Issue
**Finding:** Subscribe button shows "Creating..." until backend activation completes, but subscription only appears in list when webhook arrives.

**Current Flow:**
```
1. User clicks "Subscribe"
   ├── Button shows "Creating..."
   ├── Frontend: Create subscription onchain (via Base SDK)
   ├── Frontend: Call POST /api/subscriptions (activate)
   │   ├── Backend: Process initial charge
   │   ├── Success: Fire webhook "subscription.activated"
   │   └── Failure: Mark inactive, NO webhook fired
   └── Button returns to "Subscribe" (regardless of success/failure)

2. Webhook arrives (only on success)
   └── Frontend: Subscription appears in list
```

**Problems:**
1. **No visual feedback during onchain creation** - Button just says "Creating..." for entire flow
2. **Success only**: Subscription appears in list when webhook arrives (good)
3. **Failure case**: No webhook, subscription never appears in list
   - User sees error alert but subscription doesn't persist in UI
   - Can't see failed subscription to revoke onchain permission
   - Orphaned blockchain permission with no way to manage it

**Recommended Flow with Early Balance Check:**

```
POST /api/subscriptions (subscription creation request)
  ↓
1. Check USDC balance FIRST (pre-flight check)
   ├─ Insufficient → Return 400 immediately
   │                 NO subscription created
   │                 NO webhook fired
   │                 User sees error right away
   │
   └─ Sufficient → Continue
        ↓
2. Register subscription in database
   Fire webhook: subscription.created
   {
     "type": "subscription.created",
     "data": {
       "subscription": { "id": "0x123...", "status": "processing" }
       // No order yet, no transaction yet
     }
   }
        ↓
3. Attempt first charge (activation charge)
   ├─ Success → Fire webhook: subscription.activated
   │            {
   │              "type": "subscription.activated",
   │              "data": {
   │                "subscription": { "id": "0x123...", "status": "active" },
   │                "order": { "number": 1, "type": "initial", "status": "paid" },
   │                "transaction": { "hash": "0xabc..." }
   │              }
   │            }
   │
   └─ Failure → Fire webhook: subscription.updated (inactive)
                {
                  "type": "subscription.updated",
                  "data": {
                    "subscription": { "id": "0x123...", "status": "inactive" },
                    "order": { "number": 1, "type": "initial", "status": "failed" },
                    "error": {
                      "code": "payment_failed",
                      "reason": "Insufficient balance" // Race condition: funds removed after check
                    }
                  }
                }
```

**Event Sequence Over Subscription Lifetime:**
```
1. subscription.created          ← Registration (before first charge)
2. subscription.activated         ← First charge succeeded
3. subscription.updated (charge)  ← Recurring charge #2 succeeded
4. subscription.updated (charge)  ← Recurring charge #3 succeeded
5. subscription.updated (charge)  ← Recurring charge #4 succeeded
6. subscription.updated (failed)  ← Recurring charge #5 failed
7. subscription.updated (inactive) ← De-activated after max retries or fatal error
```

**Why Fire subscription.created Before Charge:**
1. **Failed subscriptions are visible** - Merchant can see and manage them (revoke onchain permission)
2. **Clear event sequence** - Distinguish registration from activation
3. **Testing/validation** - Can observe that failed-to-activate subscriptions don't generate future orders
4. **Audit trail** - Complete history of all subscription attempts

**Balance Check Prevents Most Creation Failures:**
- With pre-flight balance check: 99% of subscriptions succeed activation
- Rare failures after balance check = race conditions (funds removed between check and charge)
- Still fire webhook for these failures to maintain complete event history

**Benefits:**
1. **Immediate UI feedback** - Subscription appears in list right away with "processing" status
2. **Failed subscriptions visible** - User can see and revoke failed attempts
3. **Better UX** - Clear progression: created → processing → active/failed
4. **Consistent with testing needs** - Can observe and revoke failed subscriptions (see "Testing/Validation" in earlier section)

**Recommendation:**
1. **Add pre-flight balance check** - Return 400 immediately if insufficient funds, no subscription created
2. **Fire subscription.created** - When subscription is registered (after balance check passes, before charge)
3. **Fire subscription.activated OR subscription.updated(inactive)** - Based on first charge result
4. **Balance check prevents most failures** - Only race conditions slip through to create failed subscriptions
5. **Complete event history** - All webhooks fire for full audit trail

**Resolved Architecture Decisions:**

1. ✅ **Activation failures fire webhook** - `subscription.updated` with `status: inactive` and error details
2. ✅ **Pre-flight balance check** - Return 400 before creating subscription, preventing most activation failures
3. ✅ **Use `inactive_reason` field** - Distinguish specific failure types (see "Subscription Status Architecture" section)
4. ✅ **No retry mechanism for MVP** - Merchants create new subscription if first one fails
   - Simple, safe, leverages existing flow
   - Balance check makes failures rare (only race conditions)
   - Can add retry later if needed

**Merchant Recovery Flow:**
```
User creates subscription → Pre-flight balance check fails
  ↓
Return 400 error immediately
User sees: "Insufficient USDC balance. Required: 10, Available: 5"
  ↓
User adds funds to wallet
  ↓
User clicks "Subscribe" again → New subscription created ✓
```

This is safe because:
- No subscription record created on balance check failure
- No orphaned blockchain permissions
- Clear, immediate feedback

**Important Insight - Failed Subscriptions Still Exist Onchain:**

When activation fails, we have an asymmetric state:
- ✓ **Onchain**: Subscription permission was granted (exists on blockchain)
- ✗ **Backend**: Activation failed (first charge couldn't be processed)

**Webhook Payload for Failed Activation:**
```json
{
  "type": "subscription.created",  // or could be "subscription.failed"
  "data": {
    "subscription_id": "0x123...",
    "status": "inactive",
    "error": "Insufficient balance to complete payment",
    "errorCode": "INSUFFICIENT_BALANCE",
    "transaction_hash": null,  // No successful transaction
    "next_order_date": null,   // Never activated
    "order": null              // No order created
  }
}
```

**Frontend Display for Failed Subscriptions:**
```
✗ 0x123...456
  Status: inactive
  Error: Insufficient balance to complete payment
  [Revoke Permission] button
```

**Why Show Failed Subscriptions:**
1. **Transparency**: Merchant can see what went wrong
2. **Cleanup**: Merchant can revoke onchain permission that still exists
3. **Safety**: Prevents confusion about "orphaned" blockchain permissions
4. **Testing/Validation**: Critical for playground to verify backend's safety guarantee
   - Can observe that failed subscriptions never generate orders
   - Can watch scheduled runs and confirm no charges attempted
   - Validates the core promise: "Backend won't charge failed-to-register subscriptions"
   - Without seeing failed subs, can't test this critical safety feature

**Critical Action - Revoke Button:**
- Failed subscriptions still have active onchain permission
- Need "Revoke" button to clean up blockchain state
- Calls Base SDK to revoke the subscription permission
- Prevents any future charges if subscription is somehow reactivated
- After revoke: Can hide from list or mark as "revoked"

**Implementation - Revoke in Onchain Status Section:**
```typescript
import { requestRevoke } from '@base-org/account/spend-permission';

// In the Onchain Status expandable section
async function handleRevoke() {
  try {
    const hash = await requestRevoke({
      permission: onchainStatus, // The SpendPermission object from getSubscriptionStatus
      provider // The provider interface
    });
    console.log(`Permission revoked in transaction: ${hash}`);
    // Update UI: mark as revoked, maybe refresh status
  } catch (error) {
    console.error('Failed to revoke permission:', error);
  }
}

// UI placement:
// Onchain Status (expanded)
//   Is Subscribed: Yes [Revoke Permission button]
//   Owner: 0x...
//   Remaining Charge: 100
```

**Why in Onchain Status Section:**
- Onchain status shows whether permission still exists (`isSubscribed: true`)
- Logical place to manage onchain permissions
- Only appears when status is expanded (not cluttering main view)
- Clear context: "This permission exists onchain, here's how to remove it"

**Without Revoke:**
- Permission lingers on blockchain even though backend marked it inactive
- Security/hygiene issue: Orphaned permissions
- Merchant has no way to clean up failed attempts

### Pre-flight Validation - What to Check vs What SDK Handles
**Finding:** Base SDK validates permission status efficiently, but does NOT check actual token balance. Balance checking is valuable pre-flight optimization.

**What the SDK Already Checks:**
The Base SDK's charge flow includes efficient permission validation:

```typescript
// Base SDK charge flow (from @base-org/account source code)
charge()
  → prepareCharge()
    → fetchPermission() // Indexer API call (free)
    → prepareSpendCallData()
      → getPermissionStatus() // Makes 3 parallel view function calls (FREE - no gas):
        1. getCurrentPeriod()     // Check current period and spend
        2. isRevoked()            // Check if permission revoked ✅
        3. isValid()              // Check if permission approved onchain ✅

      // Validation BEFORE preparing transaction:
      → if (isRevoked) throw "Spend permission has been revoked"
      → if (spendAmount === 0) throw "Spend amount cannot be 0"
      → if (spendAmount > remainingSpend) throw "Remaining spend amount is insufficient" ✅

      → encodeFunctionData(...) // ONLY NOW: Prepare transaction data
    → return prepared calls
  → sendCalls() // ONLY NOW: Send transaction (costs gas)
```

**What the SDK Does NOT Check:**
❌ **Actual USDC balance in wallet**

The SDK only validates against the **permission allowance**, not the **actual token balance**:

```typescript
// What the SDK checks:
const remainingSpend = allowance - spent;  // Permission allowance remaining ✅

if (spendAmount > remainingSpend) {
  throw new Error('Remaining spend amount is insufficient');
}

// What the SDK DOESN'T check:
const actualBalance = await erc20.balanceOf(userWallet);  // ❌ Not checked!
```

**Problem Scenario:**
```
Permission allowance: 100 USDC/month
Remaining in period: 100 USDC (hasn't spent yet)
Actual wallet balance: 10 USDC  ← SDK doesn't check this!

Charge attempt: 100 USDC
  → Passes SDK validation ✅
  → Fails on-chain transaction ❌ (insufficient balance)
  → Gas wasted on failed transaction
```

**Recommended Pre-flight Balance Check:**

```typescript
import { CdpClient } from "@coinbase/cdp-sdk";

async function checkSufficientBalance(
  walletAddress: string,
  requiredAmount: string,
  network: string = "base"
): Promise<{ sufficient: boolean; actualBalance: string }> {
  const cdp = new CdpClient();
  const result = await cdp.evm.listTokenBalances({
    address: walletAddress,
    network: network,
  });

  // Find USDC balance
  const USDC_CONTRACT_ADDRESS = network === "base-sepolia"
    ? "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  // Base Sepolia
    : "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base Mainnet

  const usdcBalance = result.balances.find(
    item => item.token.contractAddress.toLowerCase() === USDC_CONTRACT_ADDRESS.toLowerCase()
  );

  if (!usdcBalance) {
    return { sufficient: false, actualBalance: "0" };
  }

  const actualBalance = Number(usdcBalance.amount.amount) / Math.pow(10, 6); // USDC has 6 decimals
  const required = Number(requiredAmount);

  return {
    sufficient: actualBalance >= required,
    actualBalance: actualBalance.toFixed(6)
  };
}

// In subscription activation / order processing:
const balanceCheck = await checkSufficientBalance(
  subscription.ownerAddress,
  subscription.amount,
  testnet ? "base-sepolia" : "base"
);

if (!balanceCheck.sufficient) {
  // Fail fast with clear error - no transaction sent
  return {
    error: `Insufficient USDC balance. Required: ${subscription.amount}, Available: ${balanceCheck.actualBalance}`,
    errorCode: "INSUFFICIENT_BALANCE",
    status: 400
  };
}

// Proceed with charge (SDK will still validate permission status)...
```

**Benefits of Balance Pre-flight Check:**
1. ✅ **Faster feedback** - Immediate error, no waiting for on-chain transaction to fail
2. ✅ **Save gas** - Don't waste gas on transactions that will fail due to insufficient balance
3. ✅ **Better UX** - Clear error message with actual vs required amounts
4. ✅ **Cleaner logs** - Fewer failed transactions in blockchain explorers

**Trade-offs:**
1. **Race condition** - Balance could change between check and charge
   - Mitigation: Still handle on-chain failures as fallback
   - The balance check is an optimization, not a guarantee
2. **Additional RPC call** - Adds ~50-100ms latency
   - Acceptable trade-off for avoiding failed transactions
3. **Token contract configuration** - Need to know correct USDC address per network
   - Base Mainnet: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

**Error Classification from SDK Errors:**
For errors that slip through (or from SDK permission checks), parse error messages:

```typescript
try {
  await chargeSubscription(orderId, subscriptionId, amount, recipient)
} catch (error) {
  const errorMessage = error.message;

  // Map SDK errors to specific failure reasons
  let failureReason: string;
  if (errorMessage.includes('Spend permission has been revoked')) {
    failureReason = 'REVOKED_ONCHAIN';
  } else if (errorMessage.includes('Remaining spend amount is insufficient')) {
    failureReason = 'ALLOWANCE_EXCEEDED';
  } else if (errorMessage.includes('Spend amount cannot be 0')) {
    failureReason = 'ZERO_AMOUNT';
  } else if (errorMessage.includes('Insufficient balance') || errorMessage.includes('insufficient funds')) {
    failureReason = 'INSUFFICIENT_BALANCE';
  } else {
    failureReason = 'PAYMENT_FAILED';
  }

  await markSubscriptionInactive({
    subscriptionId,
    orderId,
    reason: failureReason
  });
}
```

**Recommendation:**
- ✅ **DO** add pre-flight USDC balance check (SDK doesn't do this)
- ❌ **DON'T** add pre-flight permission status check (SDK already does this efficiently)
- ✅ Improve error parsing to extract specific failure reasons
- ✅ Use failure reasons to populate `inactive_reason` field
- ✅ Include detailed error context in webhook payloads

**Integration Points:**
1. `POST /api/subscriptions` - Check balance before calling Base SDK charge
2. Order processor - Check balance before processing recurring charges
3. Retry logic - Skip retries if balance check fails (save gas on hopeless retries)

### Base SDK - Permission Data Methods Comparison
**Finding:** Different Base SDK methods return different subsets of subscription data, and critical fields may be missing.

**Current Implementation:**
We use `getSubscriptionStatus()` to fetch onchain data:
```typescript
import { getSubscriptionStatus } from '@base-org/account/payment';

const status = await getSubscriptionStatus({
  id: subscriptionId,
  testnet: true
});

// Returns:
{
  isSubscribed: boolean,
  subscriptionOwner: string,
  owner: string,
  spender: string,
  remainingChargeInPeriod: string,
  nextPeriodStart: number,  // Unix timestamp
  recurringCharge: string    // Amount in USDC
}
```

**Problem:**
- `nextPeriodStart` tells us *when* the next period starts
- `recurringCharge` tells us *how much* will be charged
- **Missing: Period duration** - How long is one period? (30 seconds? 1 day? 1 month?)
- Cannot calculate subscription frequency without this data

**Alternative Method - `fetchPermission()`:**
We also use `fetchPermission()` for revoke functionality:
```typescript
import { fetchPermission } from '@base-org/account/spend-permission';

const permission = await fetchPermission({
  permissionHash: subscriptionId
});

// Returns SpendPermission object - potentially more complete data?
```

**Investigation Needed:**
1. Does `fetchPermission()` return period duration/length?
2. What other fields does `fetchPermission()` include that `getSubscriptionStatus()` doesn't?
3. Should we switch to using `fetchPermission()` for all status checks?
4. Can we calculate period from `nextPeriodStart` - `currentTime` on first load?

**Potential Impact:**
- **Display**: Cannot show "0.01 USDC every 30 seconds" from onchain data alone
- **Validation**: Cannot verify period matches merchant's intent
- **Debugging**: Cannot confirm subscription was created with correct parameters

**Workaround (Current):**
- Store period in backend database when subscription is created
- Return from API response for display purposes
- Only use onchain data for validation, not as source of truth for period

**Recommendation:**
- Investigate `fetchPermission()` response structure
- Document all available fields from both methods
- Determine canonical method for fetching subscription metadata
- Consider filing issue with Base SDK if period duration is truly missing

### Subscription Status Architecture - Simplification Proposal
**Finding:** Current three-state status model (`processing`, `active`, `inactive`) could be simplified to binary with reason tracking.

**Current Model:**
```sql
status TEXT CHECK(status IN ('processing', 'active', 'inactive'))
```

**Problems with Current Model:**
1. **"Processing" is ambiguous** - Is it the first charge? A retry? Onchain creation?
2. **"Inactive" lacks context** - Why is it inactive? Failed charge? User revoked? Multiple failures?
3. **Limited actionability** - Merchants can't easily determine what action to take
4. **Complex state transitions** - Three states with unclear transition rules

**Proposed Simplified Model:**
```sql
status TEXT CHECK(status IN ('active', 'inactive'))
inactive_reason TEXT CHECK(inactive_reason IN (
  'first_charge_failed',
  'recurring_charge_failed',
  'revoked_onchain',
  'insufficient_balance',
  'permission_expired',
  'max_retries_exceeded',
  NULL  -- Only NULL when status is 'active'
))
```

**Benefits:**
1. **Clear binary state** - Subscription is either working or not
2. **Rich failure context** - Know exactly why it stopped working
3. **Better UX** - Can show specific messages and recovery actions:
   - `first_charge_failed` → "Add funds and create new subscription"
   - `revoked_onchain` → "User cancelled. No action needed"
   - `recurring_charge_failed` → "Payment failed. Will retry automatically"
   - `max_retries_exceeded` → "Multiple failures. Please check balance"
4. **Cleaner logic** - No ambiguous "processing" state to handle
5. **Audit trail** - Can track reason history over time

**Status Transition Flow:**
```
Subscription Created
    ↓
First Charge Attempted
    ├─ Success → status: 'active', inactive_reason: NULL
    └─ Failure → status: 'inactive', inactive_reason: 'first_charge_failed'

Active Subscription
    ↓
Recurring Charge Due
    ├─ Success → status: 'active', inactive_reason: NULL
    ├─ Failure (retriable) → status: 'active', inactive_reason: NULL (retry later)
    └─ Failure (fatal) → status: 'inactive', inactive_reason: 'recurring_charge_failed'

User Revokes Permission
    → status: 'inactive', inactive_reason: 'revoked_onchain'

Max Retries Hit
    → status: 'inactive', inactive_reason: 'max_retries_exceeded'
```

**Migration Consideration:**
- Current `processing` state would map to either:
  - `active` with first order pending (if optimistic)
  - Wait until first charge completes, then set `active` or `inactive` with reason
- For MVP: Keep current model, add `inactive_reason` as optional field
- For v2: Remove `processing` state entirely

**Webhook Impact:**
```json
// Current
{
  "subscription": {
    "status": "inactive"  // Why? Unknown
  }
}

// Proposed
{
  "subscription": {
    "status": "inactive",
    "inactive_reason": "first_charge_failed"  // Clear!
  }
}
```

**Frontend Display:**
```typescript
// Before
status === 'inactive' ? 'Inactive' : status

// After
if (status === 'active') {
  return '✓ Active'
} else {
  switch (inactive_reason) {
    case 'first_charge_failed':
      return '✗ Activation failed - Insufficient balance'
    case 'revoked_onchain':
      return '✗ Revoked by user'
    case 'recurring_charge_failed':
      return '✗ Payment failed - Retrying...'
    default:
      return '✗ Inactive'
  }
}
```

**Recommendation:**
- **Phase 1 (MVP)**: Add optional `inactive_reason` column, populate for new failures
- **Phase 2**: Remove `processing` status, use `active`/`inactive` + reason only
- **Phase 3**: Add reason history table for audit trail of all status changes

### Competitive Analysis - Polar Deep Dive
**Status:** ✅ COMPLETED

**Summary:** Conducted comprehensive research of Polar's subscription system. They have a production-grade, feature-rich implementation with 7 subscription states, sophisticated dunning logic, metered pricing, proration, and clever engineering patterns.

**Key Findings:**

#### **1. Subscription States (7 vs our 3)**
```python
incomplete, incomplete_expired, trialing, active, past_due, canceled, unpaid
```
- **Billable states:** `trialing`, `active`, `past_due`
- **Active states:** `trialing`, `active` (customer has benefits)
- **Revoked states:** `past_due`, `canceled`, `unpaid` (benefits removed)

**Recommendation:** Adopt similar granular states + `inactive_reason` field for context.

#### **2. Dunning System (We Need This)**
- **4 automatic retries** over 21 days: `2d → 5d → 7d → 7d`
- **Smart features:**
  - Customer emails with payment links at each retry
  - Mark subscription `past_due` on first failure
  - Auto-revoke after exhausting retries
  - Skip canceled subscriptions
  - Network errors retry immediately, card errors wait for schedule
- **Hourly cron job** processes due retries

**Recommendation:** Implement dunning as Phase 4 feature with configurable retry intervals.

#### **3. Events & Webhooks**
**Subscription Events:**
- `subscription.created` - Registration
- `subscription.updated` - Any change
- `subscription.active` - Becomes/re-becomes active
- `subscription.canceled` - Scheduled cancellation
- `subscription.uncanceled` - Reactivation before end
- `subscription.revoked` - Immediate termination

**System Events (Internal):**
- `subscription.cycled` - Billing cycle completed
- `subscription.product_updated` - Plan change
- `meter.credited`, `meter.reset` - Metered usage
- `benefit.granted`, `benefit.revoked` - Access control

**Webhook Features:**
- Up to 10 retries with exponential backoff
- Multiple formats: raw JSON, Discord, Slack
- Delivery status tracking per endpoint

**Recommendation:** Add webhook retry logic and expand event catalog.

#### **4. Advanced Features**

**A. Proration (Plan Changes)**
- Double-entry bookkeeping system
- Credit unused time on old plan
- Debit remaining time on new plan
- Two behaviors: `invoice` (immediate) or `prorate` (next bill)

**B. Metered Pricing**
- Event-sourced usage tracking
- Rollover credits between periods
- Per-meter aggregation (sum, count, max)
- Billing entries created per meter per cycle

**C. Trial Management**
- Set trial during checkout or update later
- Extend or end trial via API
- Auto-transition `trialing` → `active` on cycle
- Trial start/end timestamps tracked

**D. Seats (Multi-User)**
- Subscription has `seats` count
- Invite users → `pending` status
- User claims → `claimed` status
- Revoked on cancellation

**E. Migration Tooling**
- Migrate Stripe → Polar native billing
- Validates no pending invoices/prorations
- Moves `stripe_subscription_id` to `legacy_` field
- Cancels on Stripe, continues on Polar

**Recommendation:** Proration and trials are high-value for v1. Metered pricing and seats can wait.

#### **5. Clever Engineering Patterns**

**A. Custom APScheduler Job Store**
```python
# Instead of storing jobs in DB, query subscriptions directly
def get_due_jobs(self, now: datetime):
    return select(Subscription).where(
        current_period_end <= now,
        scheduler_locked_at.is_(None),
        stripe_subscription_id.is_(None)  # Only Polar-managed
    )
```
**Benefit:** No job table, always in sync, automatic cleanup

**B. Lock-Free Scheduling**
```python
# Use timestamp instead of distributed locks
scheduler_locked_at: datetime | None  # Set when processing starts
```
**Benefit:** Simple, no Redis/external dependencies

**C. Event Sourcing for Usage**
```python
# Track usage via event stream
await event_service.create_event(SystemEvent.meter_credited, ...)
units = await meter_service.get_quantity(session, meter, events_query)
```
**Benefit:** Audit trail, time-travel queries, rollover handling

**D. Polymorphic Update API**
```python
SubscriptionUpdate = (
    SubscriptionUpdateProduct |
    SubscriptionUpdateDiscount |
    SubscriptionUpdateTrial |
    SubscriptionCancel |
    SubscriptionRevoke
)
```
**Benefit:** Type-safe, single endpoint for all updates

**Recommendation:** Adopt lock-free scheduling pattern and polymorphic updates.

#### **6. Feature Comparison**

| Feature | Polar | Couch (Current) | Priority |
|---------|-------|-----------------|----------|
| Subscription States | 7 granular | 3 basic | 🔴 High |
| Dunning/Retry | 4 attempts, 21d | None | 🔴 High |
| Event Types | 15+ events | 1 (subscription.updated) | 🟡 Medium |
| Webhook Retry | 10 retries | None | 🟡 Medium |
| Proration | Yes | No | 🟡 Medium |
| Trial Management | Yes | No | 🟡 Medium |
| Metered Pricing | Yes | No | 🟢 Low |
| Seats | Yes | No | 🟢 Low |
| External ID | Yes | No | 🟡 Medium |
| Metadata Query | Yes | No | 🟢 Low |
| Balance Tracking | Yes | No | 🟢 Low |
| Migration Tools | Stripe→Native | N/A | 🟢 Low |

#### **7. Recommended Priorities for Couch**

**Phase 1 (MVP - Current):**
- ✅ Basic subscription creation/activation
- ✅ Recurring charging via scheduler
- ✅ Revoke functionality
- ⚠️ Add `inactive_reason` field
- ⚠️ Add pre-flight balance check

**Phase 2 (Post-MVP):**
- 🔴 Implement dunning system (4 retries, customer emails)
- 🔴 Expand states: add `trialing`, `past_due`, `unpaid`
- 🟡 Webhook retry logic (exponential backoff)
- 🟡 External ID support
- 🟡 Expand event catalog (created, activated, canceled, revoked)

**Phase 3 (Enhancement):**
- 🟡 Trial period management
- 🟡 Proration for plan changes
- 🟡 Customer balance tracking
- 🟢 Multiple webhook formats

**Phase 4 (Advanced):**
- 🟢 Metered pricing
- 🟢 Seats/multi-user
- 🟢 Migration tooling

**Files of Interest:**
- `/server/polar/subscription/service.py` (2069 lines - main business logic)
- `/server/polar/subscription/scheduler.py` (custom job store)
- `/server/polar/order/service.py` (dunning logic)
- `/server/polar/config.py` (retry intervals: `[2d, 5d, 7d, 7d]`)

**Full Analysis:** See agent research output above for complete details on all flows, patterns, and implementation specifics.

### Future Improvements
- [ ] Add `amount` and `period_seconds` columns to D1 subscriptions table
- [ ] Update backend activation response to include subscription metadata
- [ ] Implement `externalId` support (like Polar) for merchant's own user IDs
- [ ] Move `checkOnchainStatus` to backend to support marking subscriptions inactive when permission is revoked
- [ ] Add error display in subscription details panel (see "Error Handling & Display" section)
- [ ] Implement simplified status model with `inactive_reason` tracking (see "Subscription Status Architecture" section)
- [ ] Complete Polar deep dive research (see "Competitive Analysis - Polar Deep Dive" section)