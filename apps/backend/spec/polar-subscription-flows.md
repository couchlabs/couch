# Polar Subscription State Transitions - Complete Flow Documentation

This document provides detailed step-by-step flows for every subscription state transition in Polar's system, including database changes, events fired, and customer impact at each step.

**Source:** Deep dive analysis of `/Users/nbx/Documents/Code/oss-contributions/polar` codebase (January 2025)

---

## Table of Contents

1. [Subscription States Overview](#subscription-states-overview)
2. [Creation → Active (Successful Activation)](#1-creation--active-successful-activation)
3. [Trialing → Active (Trial Expires)](#2-trialing--active-trial-expires)
4. [Active → Past Due (First Payment Failure)](#3-active--past_due-first-payment-failure)
5. [Past Due → Active (Retry Succeeds)](#4-past_due--active-retry-succeeds)
6. [Past Due → Unpaid (All Retries Exhausted)](#5-past_due--unpaid-all-retries-exhausted)
7. [Active → Canceled (Customer Cancels at Period End)](#6-active--canceled-customer-cancels-at-period-end)
8. [Canceled (Scheduled) → Revoked (Period Ends)](#7-canceled-scheduled--revoked-period-ends)
9. [Active → Active (Uncanceled)](#8-active-with-cancel_at_period_end--active-uncanceled)
10. [Active → Canceled (Immediate Revocation)](#9-active--canceled-immediate-revocation)
11. [Active → Active (Recurring Charge Succeeds)](#10-active--active-recurring-charge-succeeds)
12. [Key Observations](#key-observations)

---

## Subscription States Overview

Polar uses **7 distinct subscription states**:

```python
class SubscriptionStatus(StrEnum):
    incomplete = "incomplete"              # Initial setup not completed
    incomplete_expired = "incomplete_expired"  # Setup abandoned
    trialing = "trialing"                  # In trial period
    active = "active"                      # Active and paid
    past_due = "past_due"                  # Payment failed, retrying
    canceled = "canceled"                  # Terminated (terminal)
    unpaid = "unpaid"                      # Payment failed after retries (terminal)
```

**State Categories:**
- **Billable states:** `trialing`, `active`, `past_due` - can be charged
- **Active states:** `trialing`, `active` - customer has access to benefits
- **Revoked states:** `past_due`, `canceled`, `unpaid` - customer loses benefits
- **Incomplete states:** `incomplete`, `incomplete_expired` - setup not done
- **Terminal states:** `canceled`, `unpaid` - cannot be reactivated

**Source Files:**
- `/server/polar/models/subscription.py` - State definitions
- `/server/polar/subscription/service.py` - State transition logic (2069 lines)

---

## 1. Creation → Active (Successful Activation)

**Trigger:** Customer completes checkout (POST `/api/subscriptions`)

**File:** `/server/polar/subscription/service.py:293` (`create_or_update_from_checkout`)

### Step-by-Step Flow

```
POST /api/subscriptions (checkout completed)
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Validate Checkout                                       │
├─────────────────────────────────────────────────────────────────┤
│ - Product must be recurring (is_recurring = True)               │
│ - Customer must exist                                           │
│ - For Stripe: customer must have stripe_customer_id            │
│                                                                  │
│ Throws:                                                          │
│   - NotARecurringProduct                                        │
│   - MissingCheckoutCustomer                                     │
│   - MissingStripeCustomerID (if Stripe billing)                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Determine Initial Status                                │
├─────────────────────────────────────────────────────────────────┤
│ if checkout.trial_end exists:                                   │
│   status = "trialing"                                           │
│   trial_start = now                                             │
│   trial_end = checkout.trial_end                                │
│   current_period_end = trial_end                                │
│ else:                                                            │
│   status = "active"                                             │
│   started_at = now                                              │
│   current_period_end = now + recurring_interval                 │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Create Subscription Record                              │
├─────────────────────────────────────────────────────────────────┤
│ INSERT INTO subscriptions (                                     │
│   id = uuid.uuid4()                                             │
│   status = "active" or "trialing"                               │
│   customer_id = checkout.customer_id                            │
│   product_id = checkout.product_id                              │
│   payment_method_id = payment_method.id                         │
│   current_period_start = now                                    │
│   current_period_end = calculated above                         │
│   started_at = now (if active)                                  │
│   trial_start = now (if trialing)                               │
│   trial_end = checkout.trial_end (if trialing)                  │
│   recurring_interval = product.recurring_interval               │
│   currency = checkout.currency                                  │
│   amount = sum(prices.amount)                                   │
│   discount_id = checkout.discount_id                            │
│   custom_field_data = checkout.custom_field_data                │
│   user_metadata = checkout.metadata                             │
│   stripe_subscription_id = <stripe_id> (if Stripe billing)      │
│   created_at = now                                              │
│ )                                                                │
│                                                                  │
│ INSERT INTO subscription_product_prices (...)                   │
│   - Links subscription to specific price IDs                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Fire Events (in order)                                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. subscription.created webhook                                 │
│    {                                                             │
│      "type": "subscription.created",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "id": "...",                                            │
│          "status": "active" or "trialing",                       │
│          "customer": {...},                                      │
│          "product": {...},                                       │
│          "current_period_start": "2025-01-01T00:00:00Z",        │
│          "current_period_end": "2025-02-01T00:00:00Z",          │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.active webhook (ONLY if status = "active")      │
│    - Not fired for trialing subscriptions                       │
│                                                                  │
│ 3. subscription.updated webhook (legacy compatibility)          │
│                                                                  │
│ 4. Background job: customer.state_changed webhook               │
│                                                                  │
│ 5. System event: CheckoutEvent.subscription_created             │
│    - Internal event stream (not webhook)                        │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Post-Creation Actions                                   │
├─────────────────────────────────────────────────────────────────┤
│ - Grant benefits to customer (BenefitGrant records created)     │
│ - Reset meters (if product has metered pricing)                 │
│ - Link discount redemption (DiscountRedemption record)          │
│ - Send confirmation email to customer                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "active" or "trialing"                                  │
│ Database: subscription record + prices + benefit_grants created │
│ Webhooks: 3-4 webhooks sent                                     │
│ Customer: Has access to benefits (even during trial)            │
│ Next Action: Scheduler will process at current_period_end       │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:293
async def create_or_update_from_checkout(
    session: AsyncSession,
    checkout: Checkout,
    payment_method: PaymentMethod | None = None,
) -> tuple[Subscription, bool]:

    # Validation
    if not product.is_recurring:
        raise NotARecurringProduct(checkout, product)

    # Determine status
    if checkout.trial_end:
        status = SubscriptionStatus.trialing
        trial_start = utc_now()
        trial_end = checkout.trial_end
        current_period_end = trial_end
    else:
        status = SubscriptionStatus.active
        started_at = utc_now()
        current_period_end = recurring_interval.get_next_period(utc_now())

    # Create subscription
    subscription = Subscription(
        status=status,
        current_period_start=utc_now(),
        current_period_end=current_period_end,
        started_at=started_at if not trial else None,
        trial_start=trial_start if trial else None,
        trial_end=trial_end if trial else None,
        # ... more fields
    )
    session.add(subscription)

    # Post-creation hooks
    await self._after_subscription_created(session, subscription)
    await self._on_subscription_updated(session, subscription)
```

**Webhooks Sent (Active Subscription):**
1. `subscription.created`
2. `subscription.active`
3. `subscription.updated`
4. (Background) `customer.state_changed`

**Webhooks Sent (Trialing Subscription):**
1. `subscription.created`
2. `subscription.updated`
3. (Background) `customer.state_changed`

---

## 2. Trialing → Active (Trial Expires)

**Trigger:** Scheduler detects `subscription.current_period_end <= now` AND `status = "trialing"`

**File:** `/server/polar/subscription/service.py:591` (`cycle`)

### Step-by-Step Flow

```
Scheduler: subscription.current_period_end <= now AND status = "trialing"
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: cycle() Function Called                                 │
├─────────────────────────────────────────────────────────────────┤
│ previous_status = subscription.status  # "trialing"             │
│                                                                  │
│ Validate subscription is active:                                │
│   if not subscription.active:                                   │
│     raise InactiveSubscription()                                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Update Cycle Dates                                      │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   current_period_start = current_period_end,  # Trial end date  │
│   current_period_end = recurring_interval.get_next_period(...)  │
│ WHERE id = subscription.id                                      │
│                                                                  │
│ Example:                                                         │
│   Was: start=2025-01-01, end=2025-01-15 (trial)                │
│   Now: start=2025-01-15, end=2025-02-15 (first paid period)    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Transition State                                        │
├─────────────────────────────────────────────────────────────────┤
│ if previous_status == SubscriptionStatus.trialing:              │
│   UPDATE subscriptions SET                                      │
│     status = "active",                                          │
│     started_at = now  ← Mark when became active for first time  │
│   WHERE id = subscription.id                                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Check/Expire Discount                                   │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.discount:                                       │
│   if discount.is_repetition_expired(started_at, period_start): │
│     UPDATE subscriptions SET discount_id = NULL                 │
│     WHERE id = subscription.id                                  │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Create Billing Entries                                  │
├─────────────────────────────────────────────────────────────────┤
│ For each static price in subscription:                          │
│                                                                  │
│   base_amount = price.amount                                    │
│   discount_amount = 0                                           │
│   if subscription.discount:                                     │
│     discount_amount = discount.get_discount_amount(base_amount) │
│                                                                  │
│   INSERT INTO billing_entries (                                 │
│     subscription_id = subscription.id,                          │
│     type = "cycle",                                             │
│     direction = "debit",                                        │
│     amount = base_amount - discount_amount,                     │
│     discount_id = subscription.discount_id,                     │
│     discount_amount = discount_amount,                          │
│     start_timestamp = current_period_start,                     │
│     end_timestamp = current_period_end,                         │
│     created_at = now                                            │
│   )                                                              │
│                                                                  │
│ Note: Metered prices handled separately (billed on usage)       │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Create Order                                            │
├─────────────────────────────────────────────────────────────────┤
│ enqueue_job(                                                    │
│   "order.create_subscription_order",                            │
│   subscription_id = subscription.id,                            │
│   billing_reason = "subscription_cycle"                         │
│ )                                                                │
│                                                                  │
│ Background job creates:                                          │
│   INSERT INTO orders (                                          │
│     subscription_id = subscription.id,                          │
│     status = "pending",                                         │
│     billing_reason = "subscription_cycle",                      │
│     amount = sum(billing_entries.amount),                       │
│     currency = subscription.currency,                           │
│     ...                                                          │
│   )                                                              │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. System event: subscription.cycled                            │
│    {                                                             │
│      "event": "subscription.cycled",                            │
│      "metadata": {                                               │
│        "subscription_id": "...",                                │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.active webhook                                  │
│    ← Fires because transitioned trialing → active               │
│    {                                                             │
│      "type": "subscription.active",                             │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "active",                                     │
│          "started_at": "2025-01-15T00:00:00Z",                  │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. subscription.updated webhook                                 │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Send Email                                              │
├─────────────────────────────────────────────────────────────────┤
│ To: customer.email                                              │
│ Subject: "Your trial has ended - First charge processing"       │
│ Body: Invoice details, amount, next billing date                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 9: Trigger Payment (if payment method exists)              │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.payment_method_id:                              │
│   enqueue_job(                                                  │
│     "order.trigger_payment",                                    │
│     order_id = order.id,                                        │
│     payment_method_id = subscription.payment_method_id          │
│   )                                                              │
│                                                                  │
│ This will:                                                       │
│   - Charge via Stripe PaymentIntent                             │
│   - May succeed → order.status = "paid"                         │
│   - May fail → triggers dunning (see Flow #3)                   │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "trialing" → "active"                                   │
│ Database: status updated, billing_entries + order created       │
│ Webhooks: subscription.cycled, subscription.active, updated     │
│ Customer: Still has access (was already granted during trial)   │
│ Next: Payment processing (may succeed or fail)                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:591
async def cycle(
    session: AsyncSession,
    subscription: Subscription,
    update_cycle_dates: bool = True,
) -> Subscription:
    previous_status = subscription.status

    # Update cycle dates
    subscription.current_period_start = subscription.current_period_end
    subscription.current_period_end = (
        subscription.recurring_interval.get_next_period(
            subscription.current_period_end
        )
    )

    # Transition trialing → active
    if previous_status == SubscriptionStatus.trialing:
        subscription.status = SubscriptionStatus.active
        subscription.started_at = utc_now()

    # Create billing entries for static prices
    for price in static_prices:
        await billing_entry_repository.create(
            BillingEntry(
                type=BillingEntryType.cycle,
                direction=BillingEntryDirection.debit,
                amount=price.amount - discount_amount,
                # ...
            )
        )

    # Create order
    enqueue_job("order.create_subscription_order", subscription.id)
```

---

## 3. Active → Past_Due (First Payment Failure)

**Trigger:** Payment attempt fails (card declined, insufficient funds, etc.)

**File:** `/server/polar/order/service.py:1681` (`_handle_first_dunning_attempt`)

### Step-by-Step Flow

```
Payment attempt fails (insufficient funds, card declined, etc.)
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: order.trigger_payment() Catches Exception               │
├─────────────────────────────────────────────────────────────────┤
│ try:                                                             │
│   # Charge via Stripe                                           │
│   payment_intent = stripe.PaymentIntent.create(...)             │
│ except stripe.CardError as e:                                   │
│   # Card-specific errors: declined, insufficient funds, etc.    │
│   raise CardPaymentFailed(order, e)                             │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Classify Error - Do Not Retry Immediately               │
├─────────────────────────────────────────────────────────────────┤
│ if CardError:                                                   │
│   # Card errors are NOT retried immediately                     │
│   # Will be handled by dunning schedule                         │
│   log.info("Card payment failed, waiting for dunning")          │
│   # Fall through to dunning handler                             │
│                                                                  │
│ Note: Network/API errors ARE retried immediately:               │
│   except (APIConnectionError, RateLimitError):                  │
│     raise Retry()  # Immediate retry                            │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: _handle_payment_failure(order) Called                   │
├─────────────────────────────────────────────────────────────────┤
│ # Count how many times this order has failed                    │
│ failed_attempts = count_failed_payments_for_order(order.id)     │
│                                                                  │
│ if failed_attempts == 1:  # First failure                       │
│   # Route to first dunning attempt handler                      │
│   await _handle_first_dunning_attempt(session, order)           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Schedule First Retry (2 Days)                           │
├─────────────────────────────────────────────────────────────────┤
│ # From config: DUNNING_RETRY_INTERVALS = [2d, 5d, 7d, 7d]      │
│ first_retry_interval = timedelta(days=2)                        │
│ first_retry_date = utc_now() + first_retry_interval             │
│                                                                  │
│ UPDATE orders SET                                               │
│   next_payment_attempt_at = first_retry_date                    │
│ WHERE id = order.id                                             │
│                                                                  │
│ Example: Failed at 2025-01-15 10:00                             │
│          Retry at 2025-01-17 10:00                              │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Mark Subscription Past Due                              │
├─────────────────────────────────────────────────────────────────┤
│ await subscription_service.mark_past_due(session, subscription) │
│                                                                  │
│ UPDATE subscriptions SET                                        │
│   status = "past_due",                                          │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Revoke Benefits IMMEDIATELY                             │
├─────────────────────────────────────────────────────────────────┤
│ await benefit_service.revoke_benefits(session, subscription)    │
│                                                                  │
│ UPDATE benefit_grants SET                                       │
│   revoked_at = now,                                             │
│   is_granted = false                                            │
│ WHERE subscription_id = subscription.id                         │
│   AND revoked_at IS NULL                                        │
│                                                                  │
│ CRITICAL: Customer loses access immediately on first failure!   │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. order.updated webhook                                        │
│    {                                                             │
│      "type": "order.updated",                                   │
│      "data": {                                                   │
│        "order": {                                                │
│          "status": "pending",  ← Still pending, will retry      │
│          "next_payment_attempt_at": "2025-01-17T10:00:00Z",     │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.updated webhook                                 │
│    {                                                             │
│      "type": "subscription.updated",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "past_due",                                   │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. System event: subscription status changed                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Send Past Due Email                                     │
├─────────────────────────────────────────────────────────────────┤
│ await send_past_due_email(session, subscription)                │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Your {product} subscription payment is past due"      │
│ Body:                                                            │
│   - Payment failed                                              │
│   - Will retry in 2 days                                        │
│   - Payment link (if Stripe invoice available)                  │
│   - Amount owed                                                 │
│   - Update payment method link                                  │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "active" → "past_due"                                   │
│ Database:                                                        │
│   - order.next_payment_attempt_at = now + 2 days                │
│   - subscription.status = "past_due"                            │
│   - benefit_grants.revoked_at = now                             │
│ Webhooks: order.updated, subscription.updated                   │
│ Customer: Benefits IMMEDIATELY REVOKED (loses access)           │
│ Next Action: Hourly cron will retry payment in 2 days           │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/order/service.py:1681
async def _handle_first_dunning_attempt(
    session: AsyncSession,
    order: Order
) -> Order:
    # Schedule first retry for 2 days later
    first_retry_date = utc_now() + settings.DUNNING_RETRY_INTERVALS[0]

    order = await repository.update(
        order, update_dict={"next_payment_attempt_at": first_retry_date}
    )

    # Mark subscription as past_due
    if subscription := order.subscription:
        await subscription_service.mark_past_due(session, subscription)

    return order

# File: /server/polar/subscription/service.py
async def mark_past_due(
    session: AsyncSession,
    subscription: Subscription,
) -> Subscription:
    subscription.status = SubscriptionStatus.past_due

    # Revoke benefits immediately
    await benefit_service.revoke_benefits(session, subscription)

    # Send past due email
    await self.send_past_due_email(session, subscription)

    return subscription
```

**Dunning Schedule Configuration:**

```python
# File: /server/polar/config.py:289
DUNNING_RETRY_INTERVALS: list[timedelta] = [
    timedelta(days=2),   # Retry 1: +2 days = 2 days total
    timedelta(days=5),   # Retry 2: +5 days = 7 days total
    timedelta(days=7),   # Retry 3: +7 days = 14 days total
    timedelta(days=7),   # Retry 4: +7 days = 21 days total
]
```

---

## 4. Past_Due → Active (Retry Succeeds)

**Trigger:** Hourly cron finds order with `next_payment_attempt_at <= now`, payment succeeds

**File:** `/server/polar/order/tasks.py:180` (`process_dunning`)

### Step-by-Step Flow

```
Hourly Cron: process_dunning() runs
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Find Due Orders                                         │
├─────────────────────────────────────────────────────────────────┤
│ SELECT * FROM orders                                            │
│ WHERE next_payment_attempt_at <= now                            │
│   AND subscription.status != "canceled"                         │
│                                                                  │
│ For each order:                                                  │
│   enqueue_job("order.process_dunning_order", order.id)          │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Retry Payment                                           │
├─────────────────────────────────────────────────────────────────┤
│ await order.trigger_payment(payment_method_id)                  │
│                                                                  │
│ # Charge via Stripe                                             │
│ payment_intent = stripe.PaymentIntent.create(                   │
│   amount = order.amount,                                        │
│   currency = order.currency,                                    │
│   payment_method = payment_method_id,                           │
│   confirm = True                                                │
│ )                                                                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Payment Succeeds                                        │
├─────────────────────────────────────────────────────────────────┤
│ # Stripe webhook: payment_intent.succeeded                      │
│                                                                  │
│ INSERT INTO payments (                                          │
│   order_id = order.id,                                          │
│   status = "succeeded",                                         │
│   amount = order.amount,                                        │
│   processor_id = payment_intent.id,                             │
│   payment_method_id = payment_method.id,                        │
│   ...                                                            │
│ )                                                                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Mark Order Paid                                         │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE orders SET                                               │
│   status = "paid",                                              │
│   next_payment_attempt_at = NULL,  ← Clear retry schedule       │
│   payment_lock_acquired_at = NULL,                              │
│   modified_at = now                                             │
│ WHERE id = order.id                                             │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Mark Subscription Active                                │
├─────────────────────────────────────────────────────────────────┤
│ await subscription_service.mark_active(session, subscription)   │
│                                                                  │
│ UPDATE subscriptions SET                                        │
│   status = "active",                                            │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Re-Grant Benefits                                       │
├─────────────────────────────────────────────────────────────────┤
│ await benefit_service.grant_benefits(session, subscription)     │
│                                                                  │
│ # For each benefit associated with product:                     │
│ INSERT INTO benefit_grants (                                    │
│   subscription_id = subscription.id,                            │
│   benefit_id = benefit.id,                                      │
│   is_granted = true,                                            │
│   granted_at = now,                                             │
│   revoked_at = NULL,                                            │
│   ...                                                            │
│ )                                                                │
│ ON CONFLICT (subscription_id, benefit_id)                       │
│ DO UPDATE SET                                                   │
│   is_granted = true,                                            │
│   granted_at = now,                                             │
│   revoked_at = NULL                                             │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Update Payment Method (if new card used)                │
├─────────────────────────────────────────────────────────────────┤
│ # If customer updated their payment method                      │
│ if payment_method != subscription.payment_method:               │
│   UPDATE subscriptions SET                                      │
│     payment_method_id = payment_method.id                       │
│   WHERE id = subscription.id                                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. order.paid webhook                                           │
│    {                                                             │
│      "type": "order.paid",                                      │
│      "data": {                                                   │
│        "order": {                                                │
│          "status": "paid",                                       │
│          "amount": 9.99,                                         │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.active webhook ← RE-ACTIVATION!                 │
│    {                                                             │
│      "type": "subscription.active",                             │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "active",                                     │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. subscription.updated webhook                                 │
│                                                                  │
│ 4. Background: customer.state_changed webhook                   │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 9: Send Success Email                                      │
├─────────────────────────────────────────────────────────────────┤
│ To: customer.email                                              │
│ Subject: "Payment successful - Subscription reactivated"        │
│ Body:                                                            │
│   - Payment processed successfully                              │
│   - Subscription reactivated                                    │
│   - Receipt/invoice details                                     │
│   - Next billing date                                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "past_due" → "active"                                   │
│ Database:                                                        │
│   - order.status = "paid"                                       │
│   - order.next_payment_attempt_at = NULL                        │
│   - subscription.status = "active"                              │
│   - benefit_grants re-created/updated                           │
│ Webhooks: order.paid, subscription.active, subscription.updated │
│ Customer: Benefits RE-GRANTED (regains access)                  │
│ Next Action: Regular billing cycle resumes                      │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/order/tasks.py:180
@actor(
    actor_name="order.process_dunning",
    cron_trigger=CronTrigger.from_crontab("0 * * * *"),  # Hourly
    priority=TaskPriority.MEDIUM,
)
async def process_dunning() -> None:
    """Process all orders that are due for dunning (payment retry)."""
    due_orders = await order_repository.get_due_dunning_orders()

    for order in due_orders:
        enqueue_job("order.process_dunning_order", order.id)

# File: /server/polar/subscription/service.py
async def mark_active(
    session: AsyncSession,
    subscription: Subscription,
) -> Subscription:
    subscription.status = SubscriptionStatus.active

    # Re-grant benefits
    await benefit_service.grant_benefits(session, subscription)

    # Fire subscription.active webhook
    await self._on_subscription_active(session, subscription)

    return subscription
```

---

## 5. Past_Due → Unpaid (All Retries Exhausted)

**Trigger:** Payment fails on 4th retry attempt

**File:** `/server/polar/order/service.py:1694` (`_handle_consecutive_dunning_attempts`)

### Step-by-Step Flow

```
Dunning Retry Timeline:
  Initial failure: Day 0
  Retry 1: Day 2 (fails)
  Retry 2: Day 7 (fails)
  Retry 3: Day 14 (fails)
  Retry 4: Day 21 (fails) ← THIS FLOW
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Attempt Final Retry                                     │
├─────────────────────────────────────────────────────────────────┤
│ # Hourly cron triggered retry #4                                │
│ await order.trigger_payment(payment_method_id)                  │
│                                                                  │
│ # Payment fails again (card declined, insufficient funds, etc.)  │
│ raise CardPaymentFailed(order, error)                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Check Retry Count                                       │
├─────────────────────────────────────────────────────────────────┤
│ failed_attempts = count_failed_payments_for_order(order.id)     │
│ # Returns: 4 (initial + 3 retries)                              │
│                                                                  │
│ max_attempts = len(DUNNING_RETRY_INTERVALS)  # 4                │
│                                                                  │
│ if failed_attempts >= max_attempts:                             │
│   # Exhausted all retries!                                      │
│   await _handle_exhausted_dunning(session, order)               │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Stop Retrying                                           │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE orders SET                                               │
│   next_payment_attempt_at = NULL,  ← No more retries scheduled  │
│   modified_at = now                                             │
│ WHERE id = order.id                                             │
│                                                                  │
│ # Order remains in "pending" status (unpaid)                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Check if Subscription Can Be Revoked                    │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.can_cancel(immediately=True):                   │
│   # Subscription must be active or past_due                     │
│   # Must not already be canceled                                │
│   await subscription_service.revoke(session, subscription)      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Revoke Subscription                                     │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   status = "unpaid",          ← Terminal state                  │
│   ends_at = now,                                                │
│   ended_at = now,                                               │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Revoke Benefits (if not already)                        │
├─────────────────────────────────────────────────────────────────┤
│ await benefit_service.revoke_benefits(session, subscription)    │
│                                                                  │
│ # Benefits were already revoked on first failure (past_due)     │
│ # This ensures they stay revoked                                │
│                                                                  │
│ UPDATE benefit_grants SET                                       │
│   revoked_at = COALESCE(revoked_at, now),                       │
│   is_granted = false                                            │
│ WHERE subscription_id = subscription.id                         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. subscription.revoked webhook                                 │
│    {                                                             │
│      "type": "subscription.revoked",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "unpaid",                                     │
│          "ends_at": "2025-02-05T10:00:00Z",                     │
│          "ended_at": "2025-02-05T10:00:00Z",                    │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.updated webhook                                 │
│    {                                                             │
│      "type": "subscription.updated",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "unpaid",                                     │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. System event: subscription.revoked                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Send Final Email                                        │
├─────────────────────────────────────────────────────────────────┤
│ await send_subscription_revoked_email(session, subscription)    │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Your {product} subscription has ended"                │
│ Body:                                                            │
│   - Subscription terminated                                     │
│   - Reason: "Payment could not be processed after 4 attempts"   │
│   - Total amount owed (if any)                                  │
│   - Link to create new subscription                             │
│   - Customer support contact                                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "past_due" → "unpaid"                                   │
│ Database:                                                        │
│   - order.next_payment_attempt_at = NULL (no more retries)      │
│   - subscription.status = "unpaid"                              │
│   - subscription.ended_at = now                                 │
│   - benefit_grants.revoked_at set                               │
│ Webhooks: subscription.revoked, subscription.updated            │
│ Customer: Benefits revoked (already were from first failure)    │
│ Recovery: NONE - Terminal state, must create new subscription   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/order/service.py:1694
async def _handle_consecutive_dunning_attempts(
    session: AsyncSession,
    order: Order
) -> Order:
    failed_attempts = await payment_repository.count_failed_payments_for_order(
        order.id
    )

    # Check if exhausted all retries
    if failed_attempts >= len(settings.DUNNING_RETRY_INTERVALS):
        # Stop retrying
        order = await repository.update(
            order, update_dict={"next_payment_attempt_at": None}
        )

        # Revoke subscription
        if subscription is not None and subscription.can_cancel(immediately=True):
            await subscription_service.revoke(session, subscription)

        return order

    # Schedule next retry
    next_interval = settings.DUNNING_RETRY_INTERVALS[failed_attempts]
    next_retry_date = utc_now() + next_interval

    order = await repository.update(
        order, update_dict={"next_payment_attempt_at": next_retry_date}
    )

    return order
```

**Timeline Visualization:**

```
Day 0:  Payment fails → past_due, benefits revoked
Day 2:  Retry 1 fails
Day 7:  Retry 2 fails (2+5)
Day 14: Retry 3 fails (2+5+7)
Day 21: Retry 4 fails (2+5+7+7) → unpaid, subscription terminated
```

---

## 6. Active → Canceled (Customer Cancels at Period End)

**Trigger:** Customer calls cancel API with `cancel_at_period_end=True`

**File:** `/server/polar/subscription/service.py:1299` (`cancel`)

### Step-by-Step Flow

```
Customer/API: cancel_subscription(cancel_at_period_end=True)
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Validate Cancellation Request                           │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.ended_at:                                       │
│   raise AlreadyCanceledSubscription()                           │
│   # Cannot cancel already-ended subscription                    │
│                                                                  │
│ if subscription.cancel_at_period_end:                           │
│   raise AlreadyCanceledSubscription()                           │
│   # Already scheduled for cancellation                          │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Set Cancellation Fields                                 │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   cancel_at_period_end = true,                                  │
│   ends_at = current_period_end,  ← When access will end         │
│   canceled_at = now,             ← When cancellation requested  │
│   customer_cancellation_reason = reason,  # e.g. "too_expensive"│
│   customer_cancellation_comment = comment,                      │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
│                                                                  │
│ Status remains "active" - customer keeps access until period end│
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: For Stripe-Managed Subscriptions                        │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.stripe_subscription_id:                         │
│   await stripe.Subscription.modify(                             │
│     stripe_subscription_id,                                     │
│     cancel_at_period_end = True,                                │
│     cancellation_details = {                                    │
│       "feedback": reason,  # customer_service, too_expensive...│
│       "comment": comment                                        │
│     }                                                            │
│   )                                                              │
│                                                                  │
│ # Stripe will also cancel at period end                         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. subscription.canceled webhook                                │
│    {                                                             │
│      "type": "subscription.canceled",                           │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "active",  ← Still active!                   │
│          "cancel_at_period_end": true,                          │
│          "ends_at": "2025-02-01T00:00:00Z",                     │
│          "canceled_at": "2025-01-15T10:30:00Z",                 │
│          "customer_cancellation_reason": "too_expensive",       │
│          "customer_cancellation_comment": "Found cheaper alt",  │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.updated webhook                                 │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Send Cancellation Email                                 │
├─────────────────────────────────────────────────────────────────┤
│ await send_cancellation_email(session, subscription)            │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Your {product} subscription cancellation"             │
│ Body:                                                            │
│   - Cancellation confirmed                                      │
│   - You'll retain access until: {ends_at}                       │
│   - Final billing date: {current_period_end}                    │
│   - Link to uncancel (if desired)                               │
│   - Reason for leaving (if provided)                            │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: Still "active" (unchanged)                              │
│ Database:                                                        │
│   - cancel_at_period_end = True                                 │
│   - ends_at = current_period_end                                │
│   - canceled_at = now                                           │
│   - customer_cancellation_reason set                            │
│ Webhooks: subscription.canceled, subscription.updated           │
│ Customer: STILL HAS ACCESS (until period end)                   │
│ Next Action: Scheduler will revoke at current_period_end        │
│ Can Uncancel: YES (until period actually ends)                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:1299
async def cancel(
    session: AsyncSession,
    subscription: Subscription,
    *,
    customer_reason: CustomerCancellationReason | None = None,
    customer_comment: str | None = None,
) -> Subscription:
    return await self._perform_cancellation(
        session, subscription,
        customer_reason=customer_reason,
        customer_comment=customer_comment,
        immediately=False  # Key: not immediate, at period end
    )

# File: /server/polar/subscription/service.py:1339
async def _perform_cancellation(
    session: AsyncSession,
    subscription: Subscription,
    *,
    customer_reason: CustomerCancellationReason | None,
    customer_comment: str | None,
    immediately: bool,
) -> Subscription:
    if immediately:
        # Immediate revocation (see Flow #9)
        subscription.status = SubscriptionStatus.canceled
        subscription.ends_at = utc_now()
        subscription.ended_at = utc_now()
    else:
        # Scheduled cancellation
        subscription.cancel_at_period_end = True
        subscription.ends_at = subscription.current_period_end

    subscription.canceled_at = utc_now()
    subscription.customer_cancellation_reason = customer_reason
    subscription.customer_cancellation_comment = customer_comment

    # Handle Stripe if applicable
    if subscription.stripe_subscription_id:
        if immediately:
            await stripe_service.revoke_subscription(...)
        else:
            await stripe_service.cancel_subscription(...)

    # Fire events
    await self._on_subscription_canceled(session, subscription)

    return subscription
```

**Cancellation Reasons Enum:**

```python
class CustomerCancellationReason(StrEnum):
    customer_service = "customer_service"
    low_quality = "low_quality"
    missing_features = "missing_features"
    switched_service = "switched_service"
    too_complex = "too_complex"
    too_expensive = "too_expensive"
    unused = "unused"
    other = "other"
```

---

## 7. Canceled (Scheduled) → Revoked (Period Ends)

**Trigger:** Scheduler detects `current_period_end <= now` AND `cancel_at_period_end = True`

**File:** `/server/polar/subscription/service.py:591` (`cycle`)

### Step-by-Step Flow

```
Scheduler: current_period_end <= now AND cancel_at_period_end = True
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: cycle() Function Detects Cancellation Flag              │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.cancel_at_period_end:                           │
│   revoke = True                                                 │
│   # This subscription should be terminated                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Finalize Cancellation                                   │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   status = "canceled",                                          │
│   ended_at = ends_at,  ← Set actual end time (was just planned) │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
│                                                                  │
│ Note:                                                            │
│   - ends_at was already set when customer canceled              │
│   - ended_at is now set to confirm termination                  │
│   - cancel_at_period_end remains true (historical record)       │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Revoke Benefits                                         │
├─────────────────────────────────────────────────────────────────┤
│ await benefit_service.revoke_benefits(session, subscription)    │
│                                                                  │
│ UPDATE benefit_grants SET                                       │
│   revoked_at = now,                                             │
│   is_granted = false                                            │
│ WHERE subscription_id = subscription.id                         │
│   AND revoked_at IS NULL                                        │
│                                                                  │
│ IMPORTANT: Customer loses access NOW                            │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. subscription.revoked webhook                                 │
│    ← Different from subscription.canceled!                      │
│    {                                                             │
│      "type": "subscription.revoked",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "canceled",                                   │
│          "cancel_at_period_end": true,                          │
│          "ends_at": "2025-02-01T00:00:00Z",                     │
│          "ended_at": "2025-02-01T00:00:00Z",  ← Now set         │
│          "canceled_at": "2025-01-15T10:30:00Z",                 │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.updated webhook                                 │
│    {                                                             │
│      "type": "subscription.updated",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "canceled",                                   │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. System event: subscription.revoked                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Send Revocation Email                                   │
├─────────────────────────────────────────────────────────────────┤
│ await send_subscription_revoked_email(session, subscription)    │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Your {product} subscription has ended"                │
│ Body:                                                            │
│   - Subscription ended as scheduled                             │
│   - Ended on: {ended_at}                                        │
│   - Thank you message                                           │
│   - Link to resubscribe (create new subscription)               │
│   - Feedback survey (optional)                                  │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "active" → "canceled"                                   │
│ Database:                                                        │
│   - subscription.status = "canceled"                            │
│   - subscription.ended_at = now (finalized)                     │
│   - benefit_grants.revoked_at = now                             │
│ Webhooks: subscription.revoked, subscription.updated            │
│ Customer: Benefits NOW REVOKED (loses access)                   │
│ Recovery: Cannot uncancel (ended_at is set)                     │
│           Must create new subscription to resubscribe           │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:591
async def cycle(
    session: AsyncSession,
    subscription: Subscription,
    update_cycle_dates: bool = True,
) -> Subscription:
    # Check if subscription is set to cancel
    revoke = subscription.cancel_at_period_end

    if revoke:
        # Finalize cancellation
        subscription.ended_at = subscription.ends_at
        subscription.status = SubscriptionStatus.canceled

        # Revoke benefits
        await benefit_service.revoke_benefits(session, subscription)

        # Fire subscription.revoked event
        await self._on_subscription_revoked(
            session,
            subscription,
            SystemEvent.subscription_revoked
        )

        # Send revocation email
        await self.send_subscription_revoked_email(session, subscription)

        return subscription

    # Otherwise, normal cycle processing...
```

**Event Timeline:**

```
2025-01-15 10:30: Customer cancels
  → subscription.canceled webhook fired
  → status still "active", cancel_at_period_end=True

2025-02-01 00:00: Period end reached
  → subscription.revoked webhook fired
  → status changed to "canceled", ended_at set
  → Benefits revoked
```

---

## 8. Active (with cancel_at_period_end) → Active (Uncanceled)

**Trigger:** Customer changes mind, calls uncancel API before period ends

**File:** `/server/polar/subscription/service.py:1281` (`uncancel`)

### Step-by-Step Flow

```
Customer/API: uncancel_subscription()
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Validate Uncancellation Request                         │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.ended_at:                                       │
│   raise ResourceUnavailable()                                   │
│   # Too late - already ended, cannot uncancel                   │
│                                                                  │
│ if not (subscription.active and subscription.cancel_at_period_end):│
│   raise BadRequest()                                            │
│   # Nothing to uncancel - not scheduled for cancellation        │
│                                                                  │
│ # Must be:                                                       │
│ #   - status = "active" or "trialing"                           │
│ #   - cancel_at_period_end = True                               │
│ #   - ended_at = None (not yet ended)                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Clear Cancellation Fields (Polar-Managed)               │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   cancel_at_period_end = false,  ← Undo cancellation            │
│   ends_at = NULL,                ← Remove end date              │
│   canceled_at = NULL,            ← Clear cancellation timestamp │
│   customer_cancellation_reason = NULL,                          │
│   customer_cancellation_comment = NULL,                         │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
│                                                                  │
│ Status remains "active" - customer never lost access            │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: For Stripe-Managed Subscriptions                        │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.stripe_subscription_id:                         │
│   stripe_subscription = await stripe.Subscription.modify(       │
│     stripe_subscription_id,                                     │
│     cancel_at_period_end = False  ← Undo on Stripe too          │
│   )                                                              │
│                                                                  │
│   # Sync any other fields from Stripe response                  │
│   subscription.update_from_stripe(stripe_subscription)          │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. subscription.uncanceled webhook                              │
│    ← Specific event type just for uncancellation                │
│    {                                                             │
│      "type": "subscription.uncanceled",                         │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "active",                                     │
│          "cancel_at_period_end": false,  ← Changed              │
│          "ends_at": null,                ← Cleared              │
│          "canceled_at": null,            ← Cleared              │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.updated webhook                                 │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Send Uncancellation Email                               │
├─────────────────────────────────────────────────────────────────┤
│ await send_uncancellation_email(session, subscription)          │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Your {product} subscription continues"                │
│ Body:                                                            │
│   - Cancellation reversed                                       │
│   - Subscription will continue                                  │
│   - Next billing date: {current_period_end}                     │
│   - Thank you for staying                                       │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: Still "active" (never left active state)                │
│ Database:                                                        │
│   - cancel_at_period_end = False                                │
│   - ends_at = NULL                                              │
│   - canceled_at = NULL                                          │
│   - cancellation reason/comment cleared                         │
│ Webhooks: subscription.uncanceled, subscription.updated         │
│ Customer: Still has access (never lost it)                      │
│ Next Action: Normal billing cycle resumes at period end         │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:1281
async def uncancel(
    session: AsyncSession,
    subscription: Subscription
) -> Subscription:
    # Validate
    if subscription.ended_at:
        raise ResourceUnavailable()

    if not (subscription.active and subscription.cancel_at_period_end):
        raise BadRequest()

    # For Stripe-managed
    if subscription.stripe_subscription_id is not None:
        stripe_subscription = await stripe_service.uncancel_subscription(
            subscription.stripe_subscription_id,
        )
        self.update_cancellation_from_stripe(subscription, stripe_subscription)
    # For Polar-managed
    else:
        subscription.cancel_at_period_end = False
        subscription.ends_at = None

    # Clear cancellation metadata
    subscription.canceled_at = None
    subscription.customer_cancellation_reason = None
    subscription.customer_cancellation_comment = None

    # Fire subscription.uncanceled event
    await self._on_subscription_uncanceled(session, subscription)

    return subscription
```

**Use Case:**

Customer thinks they want to cancel, schedules cancellation, but then:
- Realizes they still need the product
- Decides to give it another try
- Resolves their payment issues
- Receives retention offer

As long as the period hasn't ended yet (`ended_at IS NULL`), they can reverse the cancellation with zero friction.

---

## 9. Active → Canceled (Immediate Revocation)

**Trigger:** Admin/customer calls revoke API with `immediately=True`

**File:** `/server/polar/subscription/service.py:1317` (`revoke`)

### Step-by-Step Flow

```
Admin/Customer: revoke_subscription(immediately=True)
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Set Termination Fields                                  │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   status = "canceled",                                          │
│   ends_at = now,           ← Ends immediately                   │
│   ended_at = now,          ← Already ended                      │
│   canceled_at = now,                                            │
│   customer_cancellation_reason = reason,  # Optional            │
│   customer_cancellation_comment = comment,                      │
│   modified_at = now                                             │
│ WHERE id = subscription.id                                      │
│                                                                  │
│ Note: cancel_at_period_end is NOT set (not scheduled, immediate)│
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: For Stripe-Managed Subscriptions                        │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.stripe_subscription_id:                         │
│   await stripe.Subscription.cancel(                             │
│     stripe_subscription_id,                                     │
│     prorate = False,        # Don't prorate on cancellation     │
│     invoice_now = False,    # Don't invoice immediately         │
│     cancellation_details = {                                    │
│       "feedback": reason,                                       │
│       "comment": comment                                        │
│     }                                                            │
│   )                                                              │
│                                                                  │
│ # Stripe subscription immediately canceled                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Revoke Benefits IMMEDIATELY                             │
├─────────────────────────────────────────────────────────────────┤
│ await benefit_service.revoke_benefits(session, subscription)    │
│                                                                  │
│ UPDATE benefit_grants SET                                       │
│   revoked_at = now,                                             │
│   is_granted = false                                            │
│ WHERE subscription_id = subscription.id                         │
│   AND revoked_at IS NULL                                        │
│                                                                  │
│ IMPORTANT: Customer loses access RIGHT NOW                      │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Fire Events                                             │
├─────────────────────────────────────────────────────────────────┤
│ 1. subscription.canceled webhook                                │
│    {                                                             │
│      "type": "subscription.canceled",                           │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "canceled",                                   │
│          "cancel_at_period_end": false,  ← Immediate, not sched │
│          "ends_at": "2025-01-15T14:23:10Z",                     │
│          "ended_at": "2025-01-15T14:23:10Z",  ← Same time       │
│          "canceled_at": "2025-01-15T14:23:10Z",                 │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.revoked webhook                                 │
│    ← BOTH canceled AND revoked events fire!                     │
│    {                                                             │
│      "type": "subscription.revoked",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "status": "canceled",                                   │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. subscription.updated webhook                                 │
│                                                                  │
│ 4. System event: subscription.revoked                           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Send Revocation Email                                   │
├─────────────────────────────────────────────────────────────────┤
│ await send_subscription_revoked_email(session, subscription)    │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Your {product} subscription has ended"                │
│ Body:                                                            │
│   - Subscription canceled immediately                           │
│   - Access terminated effective now                             │
│   - Reason (if provided)                                        │
│   - Refund information (if applicable)                          │
│   - Link to resubscribe                                         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "active" → "canceled"                                   │
│ Database:                                                        │
│   - subscription.status = "canceled"                            │
│   - subscription.ended_at = now (immediate)                     │
│   - benefit_grants.revoked_at = now                             │
│ Webhooks: canceled + revoked + updated (all 3!)                │
│ Customer: Benefits IMMEDIATELY REVOKED (loses access instantly) │
│ Recovery: NONE - Terminal state, must create new subscription   │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:1317
async def revoke(
    session: AsyncSession,
    subscription: Subscription,
    *,
    customer_reason: CustomerCancellationReason | None = None,
    customer_comment: str | None = None,
) -> Subscription:
    return await self._perform_cancellation(
        session, subscription,
        customer_reason=customer_reason,
        customer_comment=customer_comment,
        immediately=True  # Key difference: immediate termination
    )
```

**Comparison: Scheduled vs Immediate Cancellation**

| Aspect | Scheduled (`cancel`) | Immediate (`revoke`) |
|--------|----------------------|----------------------|
| `cancel_at_period_end` | `True` | `False` |
| `ends_at` | `current_period_end` | `now` |
| `ended_at` | Set at period end | `now` |
| Customer access | Retained until period end | Lost immediately |
| Events fired | `canceled` + `updated` | `canceled` + `revoked` + `updated` |
| Can uncancel? | Yes (until period ends) | No (already ended) |
| Typical use | Customer-initiated | Admin/fraud/refund |

---

## 10. Active → Active (Recurring Charge Succeeds)

**Trigger:** Scheduler detects `current_period_end <= now`, payment succeeds

**File:** `/server/polar/subscription/service.py:591` (`cycle`)

### Step-by-Step Flow

```
Scheduler: current_period_end <= now AND status = "active"
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: cycle() Function Called                                 │
├─────────────────────────────────────────────────────────────────┤
│ # Validate subscription is active                               │
│ if not subscription.active:                                     │
│   raise InactiveSubscription()                                  │
│                                                                  │
│ # Check if scheduled for cancellation                           │
│ if subscription.cancel_at_period_end:                           │
│   # Would go to Flow #7 instead                                 │
│   ...                                                            │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Update Cycle Dates                                      │
├─────────────────────────────────────────────────────────────────┤
│ UPDATE subscriptions SET                                        │
│   current_period_start = current_period_end,                    │
│   current_period_end = recurring_interval.get_next_period(...)  │
│ WHERE id = subscription.id                                      │
│                                                                  │
│ Example (monthly):                                               │
│   Was: start=2025-01-01, end=2025-02-01                         │
│   Now: start=2025-02-01, end=2025-03-01                         │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Check/Expire Discount                                   │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.discount:                                       │
│   # Check if discount has expired (e.g., "3 months only")       │
│   if subscription.discount.is_repetition_expired(              │
│       subscription.started_at,                                  │
│       subscription.current_period_start                         │
│   ):                                                             │
│     UPDATE subscriptions SET discount_id = NULL                 │
│     WHERE id = subscription.id                                  │
│     # Discount auto-expires, full price from now on             │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Create Billing Entries (Static Prices)                  │
├─────────────────────────────────────────────────────────────────┤
│ For each static (non-metered) price in subscription:            │
│                                                                  │
│   base_amount = price.amount                                    │
│   discount_amount = 0                                           │
│   if subscription.discount:                                     │
│     discount_amount = discount.get_discount_amount(base_amount) │
│                                                                  │
│   INSERT INTO billing_entries (                                 │
│     subscription_id = subscription.id,                          │
│     product_price_id = price.id,                                │
│     type = "cycle",                                             │
│     direction = "debit",                                        │
│     amount = base_amount - discount_amount,                     │
│     discount_id = subscription.discount_id,                     │
│     discount_amount = discount_amount,                          │
│     start_timestamp = current_period_start,                     │
│     end_timestamp = current_period_end,                         │
│     created_at = now                                            │
│   )                                                              │
│                                                                  │
│ Note: Metered prices billed separately based on usage           │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Create Order                                            │
├─────────────────────────────────────────────────────────────────┤
│ # Background job creates order from billing entries             │
│ enqueue_job(                                                    │
│   "order.create_subscription_order",                            │
│   subscription_id = subscription.id,                            │
│   billing_reason = "subscription_cycle"                         │
│ )                                                                │
│                                                                  │
│ # Job executes:                                                  │
│ INSERT INTO orders (                                            │
│   subscription_id = subscription.id,                            │
│   status = "pending",                                           │
│   billing_reason = "subscription_cycle",                        │
│   amount = sum(billing_entries.amount),                         │
│   currency = subscription.currency,                             │
│   tax_amount = calculate_tax(...),                              │
│   created_at = now                                              │
│ )                                                                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Fire Cycle Event                                        │
├─────────────────────────────────────────────────────────────────┤
│ System event: subscription.cycled                               │
│   {                                                              │
│     "event": "subscription.cycled",                             │
│     "metadata": {                                                │
│       "subscription_id": "..."                                  │
│     }                                                            │
│   }                                                              │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: Trigger Payment                                         │
├─────────────────────────────────────────────────────────────────┤
│ if subscription.payment_method_id:                              │
│   enqueue_job(                                                  │
│     "order.trigger_payment",                                    │
│     order_id = order.id,                                        │
│     payment_method_id = subscription.payment_method_id          │
│   )                                                              │
│                                                                  │
│ # Job charges via Stripe:                                        │
│ payment_intent = stripe.PaymentIntent.create(                   │
│   amount = order.amount,                                        │
│   currency = order.currency,                                    │
│   payment_method = payment_method_id,                           │
│   confirm = True,                                               │
│   metadata = {                                                   │
│     "order_id": order.id,                                       │
│     "subscription_id": subscription.id                          │
│   }                                                              │
│ )                                                                │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Payment Succeeds                                        │
├─────────────────────────────────────────────────────────────────┤
│ # Stripe webhook: payment_intent.succeeded                      │
│                                                                  │
│ INSERT INTO payments (                                          │
│   order_id = order.id,                                          │
│   status = "succeeded",                                         │
│   amount = payment_intent.amount,                               │
│   processor_id = payment_intent.id,                             │
│   created_at = now                                              │
│ )                                                                │
│                                                                  │
│ UPDATE orders SET                                               │
│   status = "paid",                                              │
│   modified_at = now                                             │
│ WHERE id = order.id                                             │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 9: Fire Success Events                                     │
├─────────────────────────────────────────────────────────────────┤
│ 1. order.paid webhook                                           │
│    {                                                             │
│      "type": "order.paid",                                      │
│      "data": {                                                   │
│        "order": {                                                │
│          "id": "...",                                            │
│          "status": "paid",                                       │
│          "amount": 9.99,                                         │
│          "billing_reason": "subscription_cycle",                │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 2. subscription.updated webhook                                 │
│    {                                                             │
│      "type": "subscription.updated",                            │
│      "data": {                                                   │
│        "subscription": {                                         │
│          "current_period_start": "2025-02-01T00:00:00Z",        │
│          "current_period_end": "2025-03-01T00:00:00Z",          │
│          ...                                                     │
│        }                                                         │
│      }                                                           │
│    }                                                             │
│                                                                  │
│ 3. System event: subscription.cycled (already fired in step 6)  │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 10: Send Receipt Email                                     │
├─────────────────────────────────────────────────────────────────┤
│ await send_receipt_email(session, order, subscription)          │
│                                                                  │
│ To: customer.email                                              │
│ Subject: "Receipt for {product} - ${amount}"                    │
│ Body:                                                            │
│   - Thank you for your payment                                  │
│   - Amount charged: $9.99                                       │
│   - Billing period: Feb 1 - Mar 1, 2025                         │
│   - Next billing date: Mar 1, 2025                              │
│   - Invoice/receipt link                                        │
│   - Manage subscription link                                    │
└─────────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────────┐
│ FINAL STATE                                                      │
├─────────────────────────────────────────────────────────────────┤
│ Status: "active" → "active" (stays active)                      │
│ Database:                                                        │
│   - current_period_start/end advanced by 1 interval             │
│   - billing_entries created for this cycle                      │
│   - order created and marked "paid"                             │
│   - payment record created                                      │
│ Webhooks: subscription.cycled, order.paid, subscription.updated │
│ Customer: Retains access, successfully charged                  │
│ Next Action: Scheduler will process again at new period end     │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code Reference:**

```python
# File: /server/polar/subscription/service.py:591
async def cycle(
    session: AsyncSession,
    subscription: Subscription,
    update_cycle_dates: bool = True,
) -> Subscription:
    # Not canceling - normal cycle

    # Update dates
    subscription.current_period_start = subscription.current_period_end
    subscription.current_period_end = (
        subscription.recurring_interval.get_next_period(
            subscription.current_period_end
        )
    )

    # Check discount expiration
    if subscription.discount:
        if subscription.discount.is_repetition_expired(...):
            subscription.discount = None

    # Create billing entries
    for price in static_prices:
        discount_amount = 0
        if subscription.discount:
            discount_amount = subscription.discount.get_discount_amount(
                price.amount
            )

        await billing_entry_repository.create(
            BillingEntry(
                type=BillingEntryType.cycle,
                direction=BillingEntryDirection.debit,
                amount=price.amount - discount_amount,
                # ...
            )
        )

    # Create order (background job)
    enqueue_job(
        "order.create_subscription_order",
        subscription.id,
        OrderBillingReason.subscription_cycle
    )

    # Fire cycle event
    await event_service.create_event(
        build_system_event(
            SystemEvent.subscription_cycled,
            metadata={"subscription_id": str(subscription.id)}
        )
    )

    return subscription
```

**Note on Payment Failure:**

If the payment fails in Step 8, this flow branches to **Flow #3 (Active → Past_Due)** instead of completing successfully.

---

## Key Observations

### When Benefits Are Revoked

| Event | Status Before | Status After | Benefits Revoked? | Timing |
|-------|---------------|--------------|-------------------|--------|
| First payment failure | active | past_due | ✅ Yes | Immediately |
| Scheduled cancellation set | active | active | ❌ No | Retains until period end |
| Scheduled cancellation executes | active | canceled | ✅ Yes | At period end |
| Immediate revocation | active | canceled | ✅ Yes | Immediately |
| Dunning exhausted | past_due | unpaid | Already revoked | N/A |
| Retry succeeds | past_due | active | ✅ Re-granted | Immediately |
| Uncancellation | active | active | N/A | Never lost |

**Critical Insight:** Benefits are revoked **immediately** on first payment failure, even though retries will continue for 21 days. This is a design choice to ensure customers only have access when paid.

### Event Firing Patterns

| Scenario | Events Fired (in order) |
|----------|-------------------------|
| **Successful activation** | `created` → `active` → `updated` |
| **Activation with trial** | `created` → `updated` |
| **Trial expires** | `cycled` → `active` → `updated` |
| **Scheduled cancellation** | `canceled` → `updated` |
| **Scheduled cancellation executes** | `revoked` → `updated` |
| **Immediate revocation** | `canceled` → `revoked` → `updated` |
| **Uncancellation** | `uncanceled` → `updated` |
| **Payment failure** | `order.updated` → `subscription.updated` |
| **Recovery from past_due** | `order.paid` → `active` → `updated` |
| **Recurring charge success** | `cycled` → `order.paid` → `updated` |
| **Dunning exhausted** | `revoked` → `updated` |

### Webhook Event Combinations

**Activation (Active):**
1. `subscription.created`
2. `subscription.active`
3. `subscription.updated`

**Activation (Trialing):**
1. `subscription.created`
2. `subscription.updated`

**Immediate Revocation:**
1. `subscription.canceled`
2. `subscription.revoked` ← Both!
3. `subscription.updated`

**Scheduled Cancellation (Two-Phase):**

Phase 1 (scheduling):
1. `subscription.canceled`
2. `subscription.updated`

Phase 2 (execution):
1. `subscription.revoked`
2. `subscription.updated`

### Database Field Patterns

**Terminal vs Non-Terminal States:**

```python
# Terminal states (cannot transition out)
if subscription.status in ["canceled", "unpaid"]:
    assert subscription.ended_at is not None
    # Cannot be reactivated

# Non-terminal states
if subscription.status in ["active", "trialing", "past_due"]:
    assert subscription.ended_at is None
    # Can still transition
```

**Cancellation States:**

```python
# Scheduled for cancellation (can be reversed)
if subscription.cancel_at_period_end and subscription.ended_at is None:
    # Can call uncancel()

# Already ended (cannot be reversed)
if subscription.ended_at is not None:
    # Cannot call uncancel()
```

**Timestamp Meanings:**

- `created_at` - When subscription record was created
- `started_at` - When subscription first became active (not set during trial)
- `trial_start` - Start of trial period (if applicable)
- `trial_end` - End of trial period (if applicable)
- `canceled_at` - When cancellation was requested (scheduled or immediate)
- `ends_at` - When subscription is scheduled to end (may be future)
- `ended_at` - When subscription actually ended (only set when terminated)

### System Events vs Webhooks

**System Events (Internal):**
- Not sent to webhooks
- Used for internal processing
- Examples: `subscription.cycled`, `meter.credited`, `benefit.granted`
- Stored in event stream for audit

**Webhooks (External):**
- Sent to merchant endpoints
- Customer-facing
- Examples: `subscription.created`, `subscription.active`, `order.paid`
- Include full resource payload

---

## Implementation Recommendations for Couch

Based on Polar's patterns, here are key recommendations:

### 1. State Granularity
✅ **Adopt similar state model:**
- Add `trialing`, `past_due`, `unpaid` states
- Keep `processing` for initial setup
- Use `inactive_reason` field for context

### 2. Event Architecture
✅ **Expand event catalog:**
- `subscription.created` - Registration
- `subscription.active` - Activation/reactivation
- `subscription.canceled` - Cancellation scheduled or immediate
- `subscription.revoked` - Access actually terminated
- `subscription.updated` - Catch-all for compatibility

### 3. Dunning System
✅ **Implement retry logic:**
- Schedule: 2d → 5d → 7d → 7d (21 days total)
- Hourly cron to process retries
- Customer emails at each retry
- Benefits revoked on first failure
- Auto-revoke after max retries

### 4. Benefit Management
✅ **Track access separately:**
- Create `benefit_grants` table
- Link to subscriptions
- Set `revoked_at` when appropriate
- Can re-grant on recovery

### 5. Cancellation Flexibility
✅ **Support both patterns:**
- Scheduled cancellation (keep access)
- Immediate revocation (lose access now)
- Allow uncancellation before period ends

### 6. Timestamp Consistency
✅ **Use clear field names:**
- `canceled_at` - When requested
- `ends_at` - When scheduled
- `ended_at` - When actually happened

### 7. Webhook Reliability
✅ **Add retry logic:**
- Up to 10 retries
- Exponential backoff
- Track delivery status
- Log failures

---

## Source File Reference

**Primary Files:**
- `/server/polar/models/subscription.py` - State definitions
- `/server/polar/subscription/service.py` - All state transition logic (2069 lines)
- `/server/polar/subscription/scheduler.py` - Cycle triggering
- `/server/polar/order/service.py` - Payment and dunning
- `/server/polar/order/tasks.py` - Dunning cron job
- `/server/polar/config.py` - Retry intervals

**Supporting Files:**
- `/server/polar/event/system.py` - System event definitions
- `/server/polar/webhook/webhooks.py` - Webhook payloads
- `/server/polar/benefit/service.py` - Benefit grant/revoke

---

## Application to Couch: Onchain/Offchain Activation Flow

This section analyzes how Polar's subscription state patterns—particularly the `incomplete` and `incomplete_expired` states—map to Couch's unique onchain/offchain architecture, and provides specific recommendations for implementation.

### The Key Parallel: Permission vs Payment

**Polar (Stripe):**
- **Permission (free)**: Payment method added
- **Payment (may fail)**: Stripe attempts charge → may fail → `incomplete` state

**Couch (Base):**
- **Permission (free)**: User signs SpendPermission onchain (local signature, no gas)
- **Payment (may fail)**: Couch attempts first charge onchain → may fail → currently marked as "failed"

**The parallel is nearly perfect** - both systems have a **commitment phase** (free, user action) and an **execution phase** (may fail, system action).

---

### Polar's Incomplete Flow - Complete Analysis

Based on deep research into Polar's codebase, here's everything about `incomplete` and `incomplete_expired` states:

#### When Subscriptions Are Marked `incomplete`

**File:** `server/polar/subscription/service.py:533-534`

Subscriptions are marked `incomplete` during **subscription creation from checkout** when Stripe's initial payment attempt fails:

```python
subscription.stripe_subscription_id = stripe_subscription.id
subscription.status = SubscriptionStatus(stripe_subscription.status)  # Sets to "incomplete" if payment failed
```

**Trigger:** Customer completes checkout → Stripe subscription created → Payment fails/requires authentication → Stripe returns status "incomplete" → Polar stores it

**Critical:** Polar NEVER directly sets this status - it only receives it from Stripe during creation.

#### When Transitions to `incomplete_expired`

**File:** `server/polar/integrations/stripe/tasks.py:310-333`

After **23 hours** without successful payment:
- Stripe automatically expires the subscription (Stripe-managed, not Polar)
- Stripe sends `customer.subscription.updated` webhook
- Polar updates status via `update_from_stripe()` method (line 1355)

**No Polar background jobs exist for this** - entirely Stripe-managed. Polar has NO `incomplete_expire_at` timestamp field or scheduler for expiration.

#### Events Fired - Complete Sequence

**For `incomplete` Status:**

**BEFORE:** None - status is set during object creation before any events

**AFTER** (from `_after_subscription_created` method, lines 736-752):
1. ✅ **`subscription.created` webhook** (line 740)
2. ✅ **`customer.webhook` background job** with `customer_state_changed` event (lines 747-751)
3. ❌ **NO activation events** (`subscription.active` returns False for incomplete)
4. ❌ **NO benefits granted** (blocked by `is_incomplete()` check at line 1706)

**For `incomplete_expired` Status:**

**BEFORE:** None - status update happens immediately when webhook received

**AFTER** (from `_after_subscription_updated` method, lines 1525-1585):
1. ✅ **`subscription.updated` webhook** (line 1584)
2. ✅ **`customer.webhook` background job** with `customer_state_changed` event (lines 1572-1576)
3. ❌ **NO activation/cancellation/revocation events** - incomplete states don't trigger these
4. ❌ **Benefits still NOT granted** (`is_incomplete()` still returns True)

#### Special Handling & Business Logic

**Benefits Are Blocked** - File: `server/polar/subscription/service.py:1699-1717`

```python
async def enqueue_benefits_grants(
    self, session: AsyncSession, subscription: Subscription
) -> None:
    # ...
    if subscription.is_incomplete():  # ⚠️ Critical check at line 1706
        return  # NO benefits granted for incomplete subscriptions!
```

**Test proof:** `tests/subscription/test_service.py:1350-1378` explicitly verifies `enqueue_job_mock.assert_not_called()` for incomplete states.

**Hidden from Main Listings** - File: `server/polar/subscription/service.py:226-227`

```python
statement = (
    repository.get_readable_statement(auth_subject)
    .where(Subscription.started_at.is_not(None))  # Excludes incomplete!
```

**Why:** `started_at` is only set when subscription becomes active (line 347-353). Incomplete subscriptions have `started_at = None`, so they're filtered out.

**Sorting Priority** - File: `server/polar/subscription/repository.py:134-152`

When sorted by status:
1. **Highest priority:** `incomplete` (1)
2. `incomplete_expired` (2)
3. `trialing` (3)
4. `active` (4-5)
5. `past_due` (6)
6. ... etc

#### Database Fields

**Status field:** `server/polar/models/subscription.py:139-141`
```python
status: Mapped[SubscriptionStatus] = mapped_column(
    StringEnum(SubscriptionStatus), nullable=False
)
```

**Critical timestamps:**
- ✅ `current_period_start` - Set even for incomplete
- ✅ `current_period_end` - Set even for incomplete
- ❌ `started_at` - **NULL for incomplete** (only set when active)
- ❌ **NO `incomplete_expire_at`** - Polar doesn't track expiration time

#### Exit Paths

**From `incomplete`:**

**Path 1: Payment Success → `active`/`trialing`**
- Stripe sends `customer.subscription.updated` webhook
- Status updated via `update_from_stripe()` (line 1355)
- `started_at` timestamp NOW set (line 1362)
- Fires: `subscription.updated` + `subscription.active` webhooks
- Benefits NOW granted
- Subscription NOW visible in listings

**Path 2: Auto-expiration → `incomplete_expired`**
- After 23 hours without payment
- Flow detailed above

**From `incomplete_expired`:**

**Path 1: Manual retry success → `active`/`trialing`**
- If merchant manually retries in Stripe dashboard
- Same events as incomplete → active

**Path 2: Deletion → `canceled`**
- Stripe sends `customer.subscription.deleted` webhook
- Handled by `customer_subscription_deleted` task (tasks.py:336-358)

#### Key Architectural Insights from Polar

1. **Stripe-Centric:** Polar delegates ALL incomplete lifecycle management to Stripe - no Polar scheduling/expiration logic exists

2. **Webhook-Driven:** All state transitions happen reactively via Stripe webhooks, not proactive polling

3. **Benefits as Gate:** `is_incomplete()` check is the critical access control preventing benefit grants until payment succeeds

4. **Hidden by Design:** Incomplete subscriptions are intentionally hidden from listings via `started_at` filter

5. **No Expiration Visibility:** Absence of expiration timestamp means Polar can't show users "expires in X hours"

6. **23-Hour Window:** Hardcoded Stripe default - not configurable in Polar

This is a **fail-safe payment architecture** - subscriptions in incomplete states are quarantined with no benefits, hidden from view, and automatically cleaned up by Stripe if payment never succeeds.

---

### What Couch Should Learn from Polar's Incomplete Flow

#### 1. Separate "Created" from "Activated" States

**Polar's approach:**
```
subscription.created event (fires even if payment fails)
↓
[Payment attempt]
├─ Success → subscription.active event
└─ Failure → stays incomplete, NO activation event
```

**Couch should adopt:**
```
subscription.created event (fires after permission signed, BEFORE charge)
↓
[First charge attempt]
├─ Success → subscription.activated event
└─ Failure → subscription.updated event (inactive, reason: first-charge-failed)
```

**Why this is better:**
- Clear analytics: see how many subscriptions are created vs activated
- User gets confirmation webhook immediately after signing (good UX)
- Failed activations are tracked separately from recurring charge failures

#### 2. Use `started_at` Timestamp as Activation Marker

**Polar's pattern:**
```sql
-- Only set when subscription becomes active for first time
started_at: NULL (for incomplete)
started_at: 2025-10-03 (for active)

-- Main listing query
WHERE started_at IS NOT NULL  -- Hides incomplete subscriptions
```

**Couch should add:**
```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  status TEXT,  -- 'pending', 'active', 'inactive'
  created_at TIMESTAMP,
  started_at TIMESTAMP,  -- ⭐ Only set on first successful charge
  -- ...
)

-- Hide pending subscriptions from main list
SELECT * FROM subscriptions WHERE started_at IS NOT NULL
```

**Benefits:**
- Clean separation: "subscription exists" vs "subscription is active"
- Users don't see failed activation attempts in their subscription list
- `started_at` = source of truth for "did this ever work?"

#### 3. Add "pending" Status for Post-Permission, Pre-Charge

**Current Couch flow (from spec):**
```
1. Check balance
2. Create subscription in DB (status: ???)
3. Fire subscription.created
4. Attempt first charge
   ├─ Success → status: active, fire subscription.activated
   └─ Failure → status: inactive, fire subscription.updated
```

**Issue:** What's the status between step 2 and step 4?

**Polar's solution:** `incomplete` status explicitly represents this limbo state

**Couch should consider:**
```typescript
enum SubscriptionStatus {
  pending = "pending",        // ⭐ Permission signed, charge not attempted yet
  active = "active",          // Currently active, last charge succeeded
  inactive = "inactive"       // Failed or revoked
}

// Reason field explains WHY inactive
enum InactiveReason {
  first_charge_failed = "first_charge_failed",
  permission_revoked = "permission_revoked",
  recurring_charge_failed = "recurring_charge_failed",
  insufficient_balance = "insufficient_balance"
}
```

**Flow becomes:**
```
1. Check balance
2. Create subscription (status: pending, started_at: NULL)
3. Fire subscription.created
4. Attempt first charge
   ├─ Success →
   │   - status: active
   │   - started_at: NOW
   │   - Fire subscription.activated
   └─ Failure →
       - status: inactive
       - inactive_reason: first_charge_failed
       - started_at: NULL (never activated!)
       - Fire subscription.updated
```

#### 4. Consider Auto-Cleanup/Expiration

**Polar:** incomplete → incomplete_expired after 23 hours (Stripe-managed)

**Couch consideration:**
- Should `pending` subscriptions auto-expire if first charge never attempted/succeeds?
- Should `inactive` (first_charge_failed) subscriptions auto-delete after X days?

**Option A: Auto-expire pending subscriptions**
```sql
-- Scheduler checks for stale pending subscriptions
UPDATE subscriptions
SET
  status = 'expired',
  inactive_reason = 'activation_timeout'
WHERE
  status = 'pending'
  AND created_at < NOW() - INTERVAL '24 hours'
```

**Option B: Let them linger but hide via started_at filter**
- Simpler implementation
- User can retry manually later
- Matches Polar's "hidden but not deleted" approach

**Recommendation:** **Option B** initially (hide via `started_at`), add auto-cleanup later if needed.

#### 5. Benefits/Access Gating

**Polar's hard gate:**
```python
if subscription.is_incomplete():
    return  # NO benefits granted
```

**Couch equivalent:**
```typescript
function shouldGrantAccess(subscription: Subscription): boolean {
  // Only grant access if subscription has been successfully activated at least once
  return subscription.started_at !== null && subscription.status === 'active'
}
```

This prevents edge cases where a subscription exists in DB but never successfully charged.

---

### Recommended Changes to Couch Activation Flow

#### Database Schema Updates

```sql
ALTER TABLE subscriptions ADD COLUMN started_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN inactive_reason TEXT;

-- Enum for status
-- 'pending': Permission granted, first charge not attempted/succeeded
-- 'active': Currently active
-- 'inactive': Failed or revoked

-- Enum for inactive_reason
-- 'first_charge_failed': Initial activation charge failed
-- 'permission_revoked': User revoked onchain permission
-- 'recurring_charge_failed': Recurring charge failed
-- 'insufficient_balance': Balance check failed
```

#### Updated Flow Implementation

```typescript
// POST /subscriptions
async function createSubscription(params) {
  // 1. Pre-flight balance check
  const balanceCheck = await checkBalance(walletAddress, amount)
  if (!balanceCheck.sufficient) {
    throw new Error('Insufficient balance')  // No subscription created
  }

  // 2. Create subscription in "pending" state
  const subscription = await db.insert({
    id: uuid(),
    status: 'pending',  // ⭐ Not active yet!
    created_at: new Date(),
    started_at: null,   // ⭐ Will be set on first successful charge
    // ...
  })

  // 3. Fire created event (even before charge attempt)
  await fireWebhook({
    type: 'subscription.created',
    subscription
  })

  // 4. Attempt first charge (activation charge)
  try {
    const txHash = await chargeSubscription(subscription)

    // 4a. Success path
    await db.update(subscription.id, {
      status: 'active',
      started_at: new Date(),  // ⭐ NOW it's started!
      transaction_hash: txHash
    })

    await fireWebhook({
      type: 'subscription.activated',
      subscription: { ...subscription, status: 'active', started_at: new Date() }
    })

  } catch (error) {
    // 4b. Failure path
    await db.update(subscription.id, {
      status: 'inactive',
      inactive_reason: 'first_charge_failed',
      started_at: null  // ⭐ Never started!
    })

    await fireWebhook({
      type: 'subscription.updated',
      subscription: {
        ...subscription,
        status: 'inactive',
        inactive_reason: 'first_charge_failed'
      }
    })
  }

  return subscription
}
```

#### Frontend Display Logic

```typescript
// Subscription list - only show successfully activated subscriptions
const activeSubscriptions = subscriptions.filter(s => s.started_at !== null)

// Subscription detail - show pending state
function getStatusDisplay(subscription: Subscription) {
  if (subscription.status === 'pending') {
    return {
      label: 'Pending',
      description: 'Activation charge in progress',
      icon: <Clock />
    }
  }

  if (subscription.status === 'inactive' && subscription.started_at === null) {
    return {
      label: 'Failed to Activate',
      description: `Reason: ${subscription.inactive_reason}`,
      icon: <X />,
      action: 'Retry'  // Allow manual retry?
    }
  }

  if (subscription.status === 'inactive' && subscription.started_at !== null) {
    return {
      label: 'Inactive',
      description: `Previously active, now inactive. Reason: ${subscription.inactive_reason}`,
      icon: <AlertCircle />
    }
  }

  // ... active handling
}
```

---

### Key Decisions for Couch

#### Decision 1: When to fire `subscription.created` event?

**Option A: Before first charge** (Polar's approach)
- ✅ Better analytics (see activation funnel)
- ✅ User gets immediate confirmation webhook
- ✅ Matches onchain reality (permission is created)
- ❌ More events to handle

**Option B: After first charge succeeds** (simpler approach)
- ✅ Simpler (only successful subscriptions fire events)
- ❌ No visibility into failed activations
- ❌ User doesn't know subscription was created if charge fails

**✅ Recommendation:** **Option A** - fire `created` after permission signed but before charge, then fire `activated` on success or `updated` on failure

**Rationale:** The onchain permission IS created when signed, even if the first charge fails. Webhooks should reflect reality.

#### Decision 2: Should failed activation subscriptions stay in system?

**Option A: Keep them** (Polar's approach)
- ✅ Can analyze failed activations
- ✅ User/merchant can manually retry
- ✅ Audit trail preserved
- ❌ Database grows with failed attempts
- **Mitigation:** Hide via `started_at IS NOT NULL` filter

**Option B: Delete them**
- ✅ Cleaner database
- ❌ Lost analytics
- ❌ No retry capability

**✅ Recommendation:** **Option A** with auto-cleanup after 7-30 days

**Rationale:** Analytics on activation failures are valuable. Storage is cheap.

#### Decision 3: Add "pending" status?

**✅ Recommendation:** **Yes** - it's semantically accurate and matches the onchain/offchain split:
- `pending` = permission granted (onchain ✅), charge not succeeded (offchain ❌)
- `active` = permission granted (onchain ✅), charge succeeded (offchain ✅)
- `inactive` = permission revoked (onchain ❌) OR charge failed (offchain ❌)

This gives you **4 distinct states** that map cleanly to the subscription lifecycle:

| Status | Permission Onchain | First Charge | Subsequent Charges | Access Granted |
|--------|-------------------|--------------|-------------------|----------------|
| `pending` | ✅ Signed | ❌ Not attempted / failed | N/A | ❌ No |
| `active` | ✅ Valid | ✅ Succeeded | ✅ Succeeding | ✅ Yes |
| `inactive` (first_charge_failed) | ✅ Valid | ❌ Failed | N/A | ❌ No |
| `inactive` (permission_revoked) | ❌ Revoked | ✅ Was OK | ❌ Will fail next | ❌ No |
| `inactive` (recurring_charge_failed) | ✅ Valid | ✅ Was OK | ❌ Failed | ❌ No |

#### Decision 4: Add auto-retry for first charge?

**Polar doesn't auto-retry** (relies on Stripe's internal retry)

**Couch could:**
- Auto-retry first charge after X minutes (e.g., 5 min, 30 min, 1 hour)
- Check balance before each retry
- Transition to `inactive` after N failed attempts

**Or:** Just fail immediately, let user manually retry or wait for next recurring charge

**✅ Recommendation:** **Fail immediately** for now, add retry logic later if needed

**Rationale:** Keep it simple initially. Onchain txns are expensive - don't want to spam retries. User can manually retry if they know they've added funds.

---

### Summary: Polar Patterns to Adopt in Couch

| Polar Pattern | Apply to Couch? | Implementation | Why |
|--------------|-----------------|----------------|-----|
| `incomplete` state | ✅ Yes (`pending`) | Add `pending` status | Matches onchain/offchain split perfectly |
| `started_at` timestamp | ✅ Yes | Add `started_at` column | Clean activation marker, enables filtering |
| Hide incomplete from listings | ✅ Yes | Filter `WHERE started_at IS NOT NULL` | Better UX, users don't see failed attempts |
| Fire `created` before payment | ✅ Yes | Fire after permission signed | Better analytics, user confirmation |
| Separate `activated` event | ✅ Yes | Fire only on first successful charge | Clear activation signal for webhooks |
| No benefits until active | ✅ Yes | Check `started_at !== null && status === 'active'` | Prevents access before first charge succeeds |
| `inactive_reason` field | ✅ Yes | Add enum column | Critical for debugging, user communication |
| Auto-expiration (23hr) | ⚠️ Maybe | Start manual cleanup, add scheduler later | Not urgent, can add if needed |
| Benefits revoke on failure | ✅ Yes | Revoke when `status !== 'active'` | Immediate access cut-off on failure |
| Dunning system (retry) | ⚠️ Later | Phase 2 feature | Complex, defer until v1 stable |

---

### Complete Revised Flow for Couch Subscriptions

```
┌─────────────────────────────────────────────────────────────────┐
│ SUBSCRIPTION CREATION & ACTIVATION FLOW                         │
└─────────────────────────────────────────────────────────────────┘

1. User initiates subscription creation
   ↓
2. Pre-flight balance check (CDP SDK)
   ├─ Insufficient → Return 400 error, NO database record, NO webhook
   └─ Sufficient → Continue
        ↓
3. User signs SpendPermission (onchain, free, local signature)
   ↓
4. Create subscription in database
   - status: 'pending'
   - created_at: NOW
   - started_at: NULL
   - permission_hash: <from signature>
   ↓
5. Fire webhook: subscription.created
   {
     type: 'subscription.created',
     subscription: { status: 'pending', started_at: null, ... }
   }
   ↓
6. Attempt first charge (activation charge)
   ↓
   ├─ SUCCESS PATH ────────────────────────────────────┐
   │  ↓                                                 │
   │  7a. Update subscription:                         │
   │      - status: 'active'                           │
   │      - started_at: NOW  ⭐                        │
   │      - transaction_hash: <tx hash>                │
   │  ↓                                                 │
   │  8a. Fire webhook: subscription.activated         │
   │      {                                             │
   │        type: 'subscription.activated',            │
   │        subscription: {                             │
   │          status: 'active',                        │
   │          started_at: <timestamp>,                 │
   │          ...                                       │
   │        }                                           │
   │      }                                             │
   │  ↓                                                 │
   │  9a. Grant access (started_at !== null)           │
   │  ↓                                                 │
   │  10a. Subscription visible in main list           │
   └────────────────────────────────────────────────────┘

   └─ FAILURE PATH ────────────────────────────────────┐
      ↓                                                 │
      7b. Update subscription:                         │
          - status: 'inactive'                         │
          - inactive_reason: 'first_charge_failed'     │
          - started_at: NULL  ⭐                       │
      ↓                                                 │
      8b. Fire webhook: subscription.updated           │
          {                                             │
            type: 'subscription.updated',              │
            subscription: {                             │
              status: 'inactive',                      │
              inactive_reason: 'first_charge_failed',  │
              started_at: null,                        │
              ...                                       │
            }                                           │
          }                                             │
      ↓                                                 │
      9b. NO access granted (started_at === null)      │
      ↓                                                 │
      10b. Hidden from main list (can retry manually)  │
      └──────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ RECURRING CHARGE FLOW (for already-active subscriptions)       │
└─────────────────────────────────────────────────────────────────┘

1. Scheduler identifies subscription.next_period_start <= NOW
   ↓
2. Subscription already has started_at set (previously activated)
   ↓
3. Attempt recurring charge
   ↓
   ├─ SUCCESS ─────────────────────────────────────────┐
   │  ↓                                                 │
   │  4a. Update subscription:                         │
   │      - status: 'active' (unchanged)               │
   │      - next_period_start: +1 period               │
   │      - started_at: unchanged  ⭐                  │
   │  ↓                                                 │
   │  5a. Fire webhook: subscription.updated           │
   │      (with charge success info)                   │
   │  ↓                                                 │
   │  6a. Access continues (still active)              │
   └────────────────────────────────────────────────────┘

   └─ FAILURE ─────────────────────────────────────────┐
      ↓                                                 │
      4b. Update subscription:                         │
          - status: 'inactive'                         │
          - inactive_reason: 'recurring_charge_failed' │
          - started_at: unchanged  ⭐ (was active!)   │
      ↓                                                 │
      5b. Fire webhook: subscription.updated           │
          (with charge failure info)                   │
      ↓                                                 │
      6b. Revoke access immediately                    │
      ↓                                                 │
      7b. Still visible in list (was previously active)│
      └──────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ KEY INSIGHT: started_at as "Was Ever Active" Marker            │
└─────────────────────────────────────────────────────────────────┘

started_at = NULL:
  - Subscription created but NEVER successfully charged
  - Hidden from main subscription list
  - Never had access
  - Examples: pending, inactive (first_charge_failed)

started_at = <timestamp>:
  - Subscription was successfully activated at least once
  - Visible in main subscription list
  - Had access at some point (may not have it now)
  - Examples: active, inactive (recurring_charge_failed, permission_revoked)
```

---

### Migration Path for Existing Couch Code

If Couch already has subscriptions in the database, here's how to migrate:

```sql
-- Add new columns
ALTER TABLE subscriptions ADD COLUMN started_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN inactive_reason TEXT;

-- Backfill started_at for existing subscriptions
-- Assumption: If subscription has status='active' OR has transaction_hash, it was activated
UPDATE subscriptions
SET started_at = created_at  -- Use created_at as approximation
WHERE
  status = 'active'
  OR transaction_hash IS NOT NULL;

-- Backfill inactive_reason for existing inactive subscriptions
UPDATE subscriptions
SET inactive_reason = CASE
  WHEN transaction_hash IS NULL THEN 'first_charge_failed'
  ELSE 'recurring_charge_failed'  -- Had tx_hash, so must have been active once
END
WHERE status = 'inactive';
```

---

### Testing Checklist for New Flow

- [ ] Create subscription with sufficient balance → pending → activated
- [ ] Create subscription with insufficient balance → 400 error, no DB record
- [ ] Create subscription, first charge fails → pending → inactive (first_charge_failed), hidden from list
- [ ] Recurring charge succeeds → stays active, started_at unchanged
- [ ] Recurring charge fails → becomes inactive (recurring_charge_failed), started_at unchanged, visible in list
- [ ] Permission revoked onchain → becomes inactive (permission_revoked), started_at unchanged
- [ ] Verify webhooks: created (always), activated (only on first success), updated (on failures and recurring)
- [ ] Verify filtering: only started_at !== null shown in main list
- [ ] Verify access control: only active + started_at !== null get access

---

This application of Polar's incomplete flow patterns to Couch's onchain/offchain architecture provides a robust, well-tested foundation for handling subscription activation failures while maintaining clear state tracking and user experience.

---

## The Orphaned Onchain Permission Problem

This section addresses a critical architectural question unique to Couch's onchain/offchain split: **What happens to the onchain SpendPermission when the first charge fails?**

### The State Mismatch

When first charge fails, you have a state mismatch:

**Onchain:** Valid SpendPermission exists (user signed it, it's live on Base)
**Offchain:** Subscription marked `inactive(first_charge_failed)` in Couch DB

The permission is "orphaned" - valid onchain but linked to a failed offchain subscription.

### Key Questions Analyzed

#### Question 1: Is this a terminal state?

**Answer: No, not truly terminal.**

**Truly terminal states:**
- `inactive(permission_revoked)` → User explicitly revoked onchain, **cannot** charge anymore
- `inactive(expired)` → Permission expired onchain, **cannot** charge anymore

**Not terminal:**
- `inactive(first_charge_failed)` → Permission is still valid onchain, **could** charge if retried

**Why failure might be temporary:**
- Insufficient balance at that moment (user could add funds)
- Network congestion (retry might work)
- Gas price spike (retry later might succeed)
- Smart contract race condition (retry might succeed)

**More accurate classification:** "Suspended pending resolution" state, not terminal.

#### Question 2: Should the onchain permission be revoked immediately?

**Answer: No, for multiple reasons:**

**1. Gas cost problem:**
- Revoking costs gas (transaction fee)
- If Couch pays: expensive, especially with many failed activations
- If user pays: they have to trigger it, might never happen
- Either way, it's wasteful for potentially temporary failures

**2. Removes retry option:**
```
User flow without immediate revocation:
1. First charge fails (insufficient balance)
2. Permission still valid onchain
3. User adds funds 5 minutes later
4. User clicks "Retry activation" in UI
5. Charge succeeds using existing permission
6. Success! ✅

User flow WITH immediate revocation:
1. First charge fails (insufficient balance)
2. Permission revoked onchain (costs gas)
3. User adds funds 5 minutes later
4. User wants to retry
5. Must create entirely new subscription (new signature, new permission)
6. Poor UX ❌
```

**3. Permission represents user consent:**
- User validly signed this permission
- They gave explicit consent to be charged
- Why revoke something they explicitly authorized?
- Leave the decision to revoke with the user

#### Question 3: What happens to the orphaned onchain permission?

**Multiple scenarios:**

**Scenario A: User forgets about it (passive)**
- Permission sits onchain, unused forever (until expiration)
- Not great, but also not harmful
- Just unused onchain data
- Will eventually expire based on permission's `end` timestamp

**Scenario B: User adds funds and wants to retry (recovery)**
- Permission is still valid onchain ✅
- Can be used to retry activation
- This is the GOOD case - we want to allow this!
- User clicks "Retry" → uses existing permission

**Scenario C: User tries to create NEW subscription for same product (duplicate prevention)**
- Couch should detect: "You already have a failed subscription for this product"
- Options:
  - Offer to retry existing subscription
  - Or: cancel old one first (user revokes permission), then create new
- Prevents duplicate permissions for same product

**Scenario D: User wants to "cancel" it (explicit cleanup)**
- Subscription was never activated
- But permission exists onchain
- User should be able to revoke permission (they pay gas)
- Updates Couch DB to `inactive(permission_revoked)`

### Comparison to Polar's Approach

**In Polar's `incomplete` flow:**

**What Stripe keeps:**
- Payment method still attached to customer
- Subscription still exists in Stripe (incomplete state)
- Nothing revoked or deleted
- Can retry payment attempt

**What happens after 23 hours:**
- Stripe marks `incomplete_expired`
- Still NOT deleted
- Still NOT revoked
- Just marked as "expired attempt"

**User can still:**
- Retry payment manually
- Or delete subscription themselves
- Payment method remains usable for other subscriptions

**Polar's philosophy:** Keep everything, allow recovery, only mark as expired timestamp. Don't destroy anything.

This is exactly the model Couch should follow for onchain permissions.

---

### Recommended Strategy: "Optimistic with Grace Period"

#### On First Charge Failure

**Implementation:**

```typescript
// When first charge fails
async function handleFirstChargeFailed(subscription: Subscription, error: Error) {
  // Update database
  await db.update(subscription.id, {
    status: 'inactive',
    inactive_reason: 'first_charge_failed',
    started_at: null,  // Never activated
    retry_available_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),  // 30 days
    retry_count: 0,
    last_error: error.message
  })

  // Fire webhook
  await fireWebhook({
    type: 'subscription.updated',
    subscription: {
      ...subscription,
      status: 'inactive',
      inactive_reason: 'first_charge_failed',
      can_retry: true,  // ⭐ Important signal to client
      retry_available_until: subscription.retry_available_until
    }
  })

  // DO NOT revoke permission onchain
  // User can retry or manually revoke

  logger.info('First charge failed, subscription inactive but permission remains valid onchain', {
    subscriptionId: subscription.id,
    permissionHash: subscription.permission_hash,
    retryAvailableUntil: subscription.retry_available_until
  })
}
```

**Behavior summary:**
1. ✅ Mark subscription as `inactive(first_charge_failed)`
2. ✅ Keep in DB for retry window (30 days)
3. ✅ Allow manual retry via UI
4. ❌ DO NOT revoke permission onchain
5. ✅ Auto-cleanup after grace period (mark as expired)

#### Scheduler Behavior

**Critical decision:** Should scheduler process failed-activation subscriptions?

**Recommendation: NO** (at least initially)

```typescript
// Scheduler only processes subscriptions that were successfully activated
const subscriptionsToCharge = await db.query(`
  SELECT * FROM subscriptions
  WHERE
    started_at IS NOT NULL  -- ⭐ Only previously-activated subscriptions
    AND status = 'active'
    AND next_period_start <= NOW()
`)
```

**Why exclude failed-activation from scheduler:**
- Prevents automatic retry spam (gas costs add up)
- Keeps scheduler focused on recurring charges (its primary purpose)
- Failed activations handled via manual retry only (user decision)
- Cleaner separation of concerns

**Alternative (Phase 2):** Add opt-in auto-retry with exponential backoff

```typescript
// Optional: Auto-retry failed activations with backoff
const subscriptionsToRetry = await db.query(`
  SELECT * FROM subscriptions
  WHERE
    status = 'inactive'
    AND inactive_reason = 'first_charge_failed'
    AND started_at IS NULL
    AND retry_count < 3  -- Max 3 auto-retries
    AND next_retry_at <= NOW()
    AND retry_available_until > NOW()
`)

// Retry schedule with exponential backoff: 1h, 6h, 24h
for (const subscription of subscriptionsToRetry) {
  try {
    await retryActivation(subscription)
  } catch (error) {
    // Update retry_count and next_retry_at
    await scheduleNextRetry(subscription)
  }
}
```

But I'd **start without this** - keep it simple, manual retry only.

#### UI Affordances

**Show failed subscriptions in special section:**

```typescript
// Separate list sections
const activeSubscriptions = subscriptions.filter(s =>
  s.started_at !== null
)

const failedActivations = subscriptions.filter(s =>
  s.status === 'inactive' &&
  s.inactive_reason === 'first_charge_failed' &&
  s.started_at === null &&
  s.retry_available_until > new Date()  // Not expired yet
)

// UI display
<>
  <h2>Active Subscriptions</h2>
  {activeSubscriptions.length === 0 && <EmptyState />}
  {activeSubscriptions.map(s => <SubscriptionCard key={s.id} subscription={s} />)}

  {failedActivations.length > 0 && (
    <>
      <h2>Failed Activations</h2>
      <Alert variant="warning">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Activation Failed</AlertTitle>
        <AlertDescription>
          These subscriptions failed to activate. The onchain permission
          remains valid. You can retry activation or revoke the permission
          to clean up.
        </AlertDescription>
      </Alert>
      {failedActivations.map(s => (
        <FailedActivationCard
          key={s.id}
          subscription={s}
          actions={
            <>
              <Button
                onClick={() => retryActivation(s.id)}
                disabled={s.retry_count >= 3}
              >
                Retry Activation {s.retry_count > 0 && `(Attempt ${s.retry_count + 1})`}
              </Button>
              <Button
                onClick={() => revokeAndCancel(s.id)}
                variant="destructive"
              >
                Revoke Permission (costs gas)
              </Button>
            </>
          }
          details={
            <div className="text-sm text-muted-foreground mt-2">
              <p>Reason: {s.last_error}</p>
              <p>Retry available until: {formatDate(s.retry_available_until)}</p>
              <p>Permission hash: <code>{s.permission_hash}</code></p>
            </div>
          }
        />
      ))}
    </>
  )}
</>
```

#### Prevent Duplicate Subscriptions

**Check before creating new subscription:**

```typescript
async function createSubscription(
  productId: string,
  walletAddress: string
): Promise<Subscription> {
  // Check for existing subscription (any status)
  const existing = await db.subscriptions.findFirst({
    where: {
      product_id: productId,
      wallet_address: walletAddress,
      // Don't filter by status - check ALL subscriptions
    }
  })

  if (existing) {
    // Case 1: Failed activation still in retry window
    if (
      existing.status === 'inactive' &&
      existing.inactive_reason === 'first_charge_failed' &&
      existing.started_at === null &&
      existing.retry_available_until > new Date()
    ) {
      throw new ApiError(409,
        'You have an existing subscription that failed activation. ' +
        'Please retry it or cancel it before creating a new one.',
        { existingSubscriptionId: existing.id }
      )
    }

    // Case 2: Already active
    if (existing.status === 'active') {
      throw new ApiError(409,
        'You already have an active subscription for this product.',
        { existingSubscriptionId: existing.id }
      )
    }

    // Case 3: Inactive but was previously active (permission likely revoked)
    if (
      existing.status === 'inactive' &&
      existing.started_at !== null
    ) {
      // Could allow new subscription since old one was terminated
      // But check if permission is actually revoked first
      const onchainStatus = await getPermissionStatus(existing.permission_hash)
      if (!onchainStatus.isRevoked) {
        throw new ApiError(409,
          'You have an existing subscription that is inactive but permission is still valid. ' +
          'Please revoke it first.',
          { existingSubscriptionId: existing.id }
        )
      }
      // If revoked, allow new subscription to be created
    }
  }

  // Proceed with creation...
  return createNewSubscription(productId, walletAddress)
}
```

#### Cleanup Strategy

**Option A: Soft expiration (recommended)**

```sql
-- Daily cleanup job
UPDATE subscriptions
SET
  status = 'expired',
  inactive_reason = 'activation_expired'
WHERE
  status = 'inactive'
  AND inactive_reason = 'first_charge_failed'
  AND started_at IS NULL
  AND retry_available_until < NOW()
```

Still don't revoke onchain (gas cost). Just mark as expired in DB.

**User can still manually revoke if they want later.**

**Option B: Allow user-triggered cleanup**

```typescript
// User clicks "Cancel & Revoke"
async function cancelFailedActivation(subscriptionId: string) {
  const subscription = await db.subscriptions.findById(subscriptionId)

  if (!subscription) {
    throw new Error('Subscription not found')
  }

  if (subscription.started_at !== null) {
    throw new Error('Cannot cancel subscription that was already activated')
  }

  // User pays gas to revoke permission onchain
  logger.info('User revoking permission for failed activation', {
    subscriptionId,
    permissionHash: subscription.permission_hash
  })

  const tx = await revokeSpendPermission(
    subscription.permission_hash,
    subscription.wallet_address  // User's wallet signs & pays
  )

  await tx.wait()

  // Update database
  await db.update(subscriptionId, {
    status: 'inactive',
    inactive_reason: 'permission_revoked',
    revoked_at: new Date(),
    revoke_tx_hash: tx.hash
  })

  // Fire webhook
  await fireWebhook({
    type: 'subscription.updated',
    subscription: {
      ...subscription,
      status: 'inactive',
      inactive_reason: 'permission_revoked',
      revoked_at: new Date()
    }
  })

  return { success: true, txHash: tx.hash }
}
```

#### Periodic Onchain State Sync

**Important:** Scheduler should check if permissions were revoked externally

```typescript
// Daily job: Sync onchain state with Couch DB
async function syncOnchainPermissionState() {
  // Get all subscriptions with valid permissions that aren't marked as revoked
  const subscriptionsWithPermissions = await db.query(`
    SELECT * FROM subscriptions
    WHERE
      permission_hash IS NOT NULL
      AND (
        status != 'inactive'
        OR inactive_reason != 'permission_revoked'
      )
  `)

  logger.info('Syncing onchain permission state', {
    count: subscriptionsWithPermissions.length
  })

  for (const sub of subscriptionsWithPermissions) {
    try {
      const onchainStatus = await getPermissionStatus(sub.permission_hash)

      // Check if permission was revoked externally
      if (onchainStatus.isRevoked) {
        logger.warn('Permission was revoked externally (not via Couch)', {
          subscriptionId: sub.id,
          permissionHash: sub.permission_hash,
          walletAddress: sub.wallet_address
        })

        // User revoked externally (via wallet UI or other dApp)
        await db.update(sub.id, {
          status: 'inactive',
          inactive_reason: 'permission_revoked',
          revoked_at: new Date(),
          revoked_externally: true  // Flag for tracking
        })

        await fireWebhook({
          type: 'subscription.updated',
          subscription: {
            ...sub,
            status: 'inactive',
            inactive_reason: 'permission_revoked',
            revoked_externally: true
          }
        })
      }

      // Check if permission has expired
      if (onchainStatus.end < Date.now()) {
        logger.info('Permission has expired', {
          subscriptionId: sub.id,
          permissionHash: sub.permission_hash,
          expiredAt: new Date(onchainStatus.end)
        })

        await db.update(sub.id, {
          status: 'inactive',
          inactive_reason: 'permission_expired',
          expired_at: new Date(onchainStatus.end)
        })

        await fireWebhook({
          type: 'subscription.updated',
          subscription: {
            ...sub,
            status: 'inactive',
            inactive_reason: 'permission_expired'
          }
        })
      }
    } catch (error) {
      logger.error('Error syncing permission state', {
        subscriptionId: sub.id,
        error: error.message
      })
      // Continue with other subscriptions
    }
  }
}

// Run daily at 2am
cron.schedule('0 2 * * *', syncOnchainPermissionState)
```

This catches cases where user revokes permission directly onchain (via wallet, block explorer, or other dApp), keeping Couch DB in sync with reality.

---

### Complete State Diagram Including Orphaned Permissions

```
User creates subscription
         ↓
    [Sign permission onchain - FREE]
         ↓
    status: pending
    started_at: NULL
    permission valid onchain: ✅
         ↓
    [First charge attempted]
         ↓
    ┌────────┴─────────┐
    │                  │
 SUCCESS            FAILURE
    │                  │
    ↓                  ↓
 status: active     status: inactive
 started_at: NOW    reason: first_charge_failed
 permission: ✅     started_at: NULL
 visible: YES       permission: ✅ (still valid onchain!)
    │               visible: NO (in "Failed Activations" section)
    │                  │
    │                  ├─────→ [Manual retry by user]
    │                  │           ↓
    │                  │       [Charge attempted again]
    │                  │           ↓
    │                  │       ┌───┴────┐
    │                  │    SUCCESS   FAILURE
    │                  │       ↓         ↓
    │                  │    ┌───────────┘
    │                  │    │ (loops back up to active state)
    │                  │    └→ status: active
    │                  │       started_at: NOW
    │                  │
    │                  ├─────→ [User manually revokes]
    │                  │           ↓
    │                  │       permission: ❌ (revoked onchain)
    │                  │       status: inactive
    │                  │       reason: permission_revoked
    │                  │       TRULY TERMINAL ⚰️
    │                  │
    │                  └─────→ [30 days pass, no action]
    │                              ↓
    │                          status: expired
    │                          reason: activation_expired
    │                          permission: ✅ (orphaned onchain until expiration)
    │
    ↓
 [Recurring charges via scheduler]
    ↓
 ┌──┴───┐
 │      │
SUCCESS FAILURE
 │      │
 ↓      ↓
stay   status: inactive
active reason: recurring_charge_failed
       started_at: UNCHANGED (was previously active!)
       permission: ✅ (probably still valid)
       visible: YES (still in main list, was active before)
```

---

### Database Schema Additions for Orphan Handling

```sql
-- Add fields to track retry behavior and orphan state
ALTER TABLE subscriptions ADD COLUMN retry_available_until TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN next_retry_at TIMESTAMP;
ALTER TABLE subscriptions ADD COLUMN last_error TEXT;
ALTER TABLE subscriptions ADD COLUMN revoked_externally BOOLEAN DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN revoke_tx_hash TEXT;

-- Update inactive_reason enum to include all cases
-- 'first_charge_failed': Initial activation charge failed
-- 'permission_revoked': User revoked onchain permission (manual or via UI)
-- 'permission_expired': Permission expired onchain (based on end timestamp)
-- 'recurring_charge_failed': Recurring charge failed
-- 'insufficient_balance': Balance check failed
-- 'activation_expired': Failed activation exceeded retry window
```

---

### Summary: Handling Orphaned Permissions

#### Answers to Critical Questions

**Q: Should onchain permission be rescinded when first charge fails?**

**A: No.**

Reasons:
- Gas cost prohibitive (especially at scale)
- Removes retry option (poor UX)
- User validly consented to permission
- Permission will expire naturally

**Q: Can we assume that subscription won't try to be activated/resent?**

**A: No assumption needed.**

Design explicitly for retry:
- Manual retry via UI (recommended for v1)
- Automatic retry with limits (optional for v2)
- Prevent duplicate subscriptions (check before create)

**Q: What do you do with the onchain "orphan"?**

**A: Leave it, with guardrails.**

Strategy:
- Keep permission valid onchain
- Allow user to retry activation manually
- Allow user to manually revoke if they want (they pay gas)
- Sync DB if permission is revoked externally
- Mark as expired in DB after grace period (30 days)
- Permission will eventually expire onchain based on its `end` timestamp

**Q: Is it a terminal state?**

**A: No.**

Classification:
- **Not terminal:** `inactive(first_charge_failed)` - can retry
- **Terminal:** `inactive(permission_revoked)` - cannot retry
- **Terminal:** `inactive(permission_expired)` - cannot retry

---

### The Philosophy: Be Optimistic About Recovery

Follow Polar's lead: **Keep state, allow retry, mark as expired timestamp, but don't destroy anything.**

**Key principles:**

1. **Preserve user consent** - User signed permission, honor it until they revoke
2. **Enable recovery** - Failed != permanent, allow retries
3. **Minimize gas costs** - Don't revoke onchain unless necessary
4. **Hide, don't delete** - Keep failed activations for analytics, hide from main UI
5. **Let time or user clean up** - Auto-expire in DB after grace period, or let user revoke manually
6. **Sync reality** - Check onchain state periodically to catch external revocations

**The onchain "orphan" is not a bug, it's a feature** - it preserves the user's ability to retry without re-signing and demonstrates respect for their explicit consent.

This architecture balances:
- Gas efficiency (no unnecessary revocations)
- User experience (can retry easily)
- Data integrity (DB syncs with onchain reality)
- Clean UX (failed activations hidden from main view)
- Analytics (all attempts preserved)

---

## REST API Design for Subscription Creation and Retry

This section defines the HTTP API semantics for subscription creation and activation retry, ensuring proper REST conventions.

### Endpoint Design

**Initial creation: POST**
```http
POST /subscriptions
Content-Type: application/json

{
  "productId": "prod_123",
  "walletAddress": "0x...",
  "period": "monthly"
}
```

**Manual retry: POST to action endpoint** (not PUT)
```http
POST /subscriptions/{id}/retry
# or
POST /subscriptions/{id}/activate
```

### Why POST (not PUT) for Retry?

**PUT semantics (NOT appropriate):**
- PUT = Replace entire resource
- Idempotent (calling multiple times produces same result)
- Example: `PUT /subscriptions/{id}` with full subscription object
- Used for: "Set this resource to this exact state"

**Retry is an ACTION, not a replacement:**
- Not replacing the subscription data
- Triggering a process (onchain charge attempt)
- NOT idempotent - each retry:
  - Costs gas (different transaction each time)
  - Could succeed or fail differently
  - Creates new transaction hash
  - Updates different fields based on outcome
  - Increments retry_count

**POST to action endpoint is REST best practice for non-idempotent operations.**

### Complete API Specification

#### POST /subscriptions - Create Subscription

**Request:**
```json
{
  "productId": "prod_123",
  "walletAddress": "0x1234...",
  "period": "monthly"
}
```

**Response 201 Created (activation succeeded):**
```json
{
  "id": "sub_abc",
  "status": "active",
  "started_at": "2025-10-03T15:30:00Z",
  "permission_hash": "0x...",
  "transaction_hash": "0x...",
  "next_period_start": "2025-11-03T15:30:00Z"
}
```

**Response 201 Created (activation failed):**
```json
{
  "id": "sub_abc",
  "status": "inactive",
  "inactive_reason": "first_charge_failed",
  "started_at": null,
  "permission_hash": "0x...",
  "can_retry": true,
  "retry_available_until": "2025-11-03T00:00:00Z",
  "retry_count": 0,
  "last_error": "Insufficient balance"
}
```

**Response 400 Bad Request (pre-flight check failed):**
```json
{
  "error": "Insufficient balance",
  "details": {
    "required": "10.00 USDC",
    "actual": "5.00 USDC"
  }
}
```

#### POST /subscriptions/{id}/retry - Retry Activation

**Request:**
```http
POST /subscriptions/sub_abc/retry
```

Optional body:
```json
{
  "skipBalanceCheck": false
}
```

**Response 200 OK (retry succeeded):**
```json
{
  "id": "sub_abc",
  "status": "active",
  "started_at": "2025-10-03T16:45:00Z",
  "transaction_hash": "0x...",
  "retry_count": 1,
  "next_period_start": "2025-11-03T16:45:00Z"
}
```

**Response 200 OK (retry failed):**
```json
{
  "id": "sub_abc",
  "status": "inactive",
  "inactive_reason": "first_charge_failed",
  "started_at": null,
  "can_retry": true,
  "retry_count": 1,
  "retry_available_until": "2025-11-03T00:00:00Z",
  "last_error": "Transaction reverted: InsufficientAllowance"
}
```

**Response 400 Bad Request (retry not available):**
```json
{
  "error": "Retry not available",
  "reason": "Retry window expired",
  "retry_available_until": "2025-10-15T00:00:00Z"
}
```

**Response 400 Bad Request (already activated):**
```json
{
  "error": "Cannot retry subscription that was already activated",
  "started_at": "2025-10-03T15:30:00Z"
}
```

**Response 404 Not Found:**
```json
{
  "error": "Subscription not found"
}
```

### Backend Implementation

```typescript
// Route definitions
app.post('/subscriptions', createSubscription)
app.post('/subscriptions/:id/retry', retryActivation)

async function retryActivation(req: Request, res: Response) {
  const { id } = req.params
  const subscription = await db.subscriptions.findById(id)

  // Validation
  if (!subscription) {
    return res.status(404).json({ error: 'Subscription not found' })
  }

  if (subscription.started_at !== null) {
    return res.status(400).json({
      error: 'Cannot retry subscription that was already activated',
      started_at: subscription.started_at
    })
  }

  if (subscription.retry_available_until < new Date()) {
    return res.status(400).json({
      error: 'Retry window expired',
      retry_available_until: subscription.retry_available_until
    })
  }

  // Optional: Check max retry attempts
  if (subscription.retry_count >= 10) {
    return res.status(400).json({
      error: 'Maximum retry attempts exceeded',
      retry_count: subscription.retry_count
    })
  }

  // Attempt charge
  try {
    const txHash = await chargeSubscription(subscription)

    // Success - update to active
    const updated = await db.update(subscription.id, {
      status: 'active',
      started_at: new Date(),
      transaction_hash: txHash,
      retry_count: subscription.retry_count + 1,
      next_period_start: calculateNextPeriod(new Date(), subscription.period)
    })

    await fireWebhook({
      type: 'subscription.activated',
      subscription: updated
    })

    return res.status(200).json(updated)

  } catch (error) {
    // Failed again - still inactive
    const updated = await db.update(subscription.id, {
      retry_count: subscription.retry_count + 1,
      last_error: error.message
    })

    await fireWebhook({
      type: 'subscription.updated',
      subscription: updated
    })

    return res.status(200).json(updated)  // 200 = action completed, check status
  }
}
```

### Frontend Implementation

```typescript
// Initial creation
async function createSubscription(productId: string, walletAddress: string) {
  const response = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, walletAddress, period: 'monthly' })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const subscription = await response.json()

  // Check if activation succeeded or failed
  if (subscription.status === 'active') {
    toast.success('Subscription activated!')
  } else if (subscription.status === 'inactive') {
    toast.error('Activation failed. You can retry.')
  }

  return subscription
}

// Retry activation
async function retryActivation(subscriptionId: string) {
  const response = await fetch(`/api/subscriptions/${subscriptionId}/retry`, {
    method: 'POST',  // ⭐ POST, not PUT
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const subscription = await response.json()

  if (subscription.status === 'active') {
    toast.success('Subscription activated successfully!')
  } else {
    toast.error(`Retry failed: ${subscription.last_error}`)
  }

  return subscription
}

// UI Component
function FailedActivationCard({ subscription }: { subscription: Subscription }) {
  const [isRetrying, setIsRetrying] = useState(false)

  const handleRetry = async () => {
    setIsRetrying(true)
    try {
      const updated = await retryActivation(subscription.id)
      if (updated.status === 'active') {
        // Refresh subscription list or navigate to active subscription
        router.refresh()
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <Card>
      <CardContent>
        <div className="flex justify-between items-center">
          <div>
            <p className="font-semibold">Failed Activation</p>
            <p className="text-sm text-muted-foreground">
              {subscription.last_error}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Retry available until {formatDate(subscription.retry_available_until)}
            </p>
          </div>
          <Button
            onClick={handleRetry}
            disabled={isRetrying || subscription.retry_count >= 10}
          >
            {isRetrying ? 'Retrying...' : `Retry Activation`}
            {subscription.retry_count > 0 && ` (${subscription.retry_count})`}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

### Other Action Endpoints for Consistency

Following the same pattern, other subscription actions would also use POST:

```http
# Revoke permission and cancel
POST /subscriptions/{id}/revoke

# Cancel subscription (schedule for end of period)
POST /subscriptions/{id}/cancel

# Uncancel (resume scheduled cancellation)
POST /subscriptions/{id}/uncancel
```

All of these are actions (not resource replacements), so they use POST to action endpoints.

### Summary: REST Semantics

| Operation | Method | Endpoint | Idempotent | Reasoning |
|-----------|--------|----------|------------|-----------|
| Create subscription | POST | `/subscriptions` | No | Creates new resource |
| Retry activation | POST | `/subscriptions/{id}/retry` | No | Triggers onchain action, costs gas |
| Get subscription | GET | `/subscriptions/{id}` | Yes | Read operation |
| List subscriptions | GET | `/subscriptions` | Yes | Read operation |
| Update subscription metadata | PATCH | `/subscriptions/{id}` | No | Partial update of fields |
| Replace subscription | PUT | `/subscriptions/{id}` | Yes | Full replacement (rarely used) |
| Revoke permission | POST | `/subscriptions/{id}/revoke` | No | Triggers onchain action |
| Cancel subscription | POST | `/subscriptions/{id}/cancel` | No | State change with side effects |

**Key principle:** Actions that trigger side effects (webhooks, onchain transactions, state changes) use POST to action endpoints, not PUT/PATCH.

---

This document provides the complete picture of subscription state transitions in Polar. Every flow, every event, every database change is documented with step-by-step detail.
