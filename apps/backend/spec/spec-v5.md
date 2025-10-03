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
- [ ] Alchemy.run setup (D1)
- [ ] Frontend setup with clean empty entry point fully wired and setup
  - Hello world with react query work (ie on proxy/...health)
  - Shadcn configured
  - Components/Theme correctly setup
  - Database exposed to worker

### Phase 1: Core Functionality
- [ ] Subscription creator UI
- [ ] Basic subscription list
- [ ] Create subscription flow
- [ ] Status indicators

### Phase 2: Enhanced Features
- [ ] Expandable details
- [ ] Onchain status checking
- [ ] Error handling
- [ ] Loading states

### Phase 3: Polish
- [ ] Add poller on _scheduled on backend to trigger order scheduler
- [ ] Fine tune design/layout/appearance
- [ ] Move base+call to backend into couch-sdk package
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