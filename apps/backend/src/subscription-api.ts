import { Hono } from "hono"
import { base, SubscriptionStatus } from "@base-org/account"
import { cors } from "hono/cors"

import { CloudflareEnv } from "../types/env"

export * from "./subscription-billing"

const app = new Hono<{ Bindings: CloudflareEnv }>()

app.use(cors())

app.post("/api/subscriptions", async (c) => {
  try {
    const body = await c.req.json().catch(() => null)
    const subscriptionId = body?.subscription_id

    // Validate mandatory subscription_id
    if (!subscriptionId) {
      return c.json({ error: "subscription_id is required" }, 400)
    }

    // 2. Check if subscription already exists in database
    const existing = await c.env.SUBSCRIPTIONS.prepare(
      "SELECT * FROM subscriptions WHERE subscription_id = ?",
    )
      .bind(subscriptionId)
      .first()

    if (existing) {
      return c.json({ error: "Subscription already exists" }, 409)
    }

    // 3. Validate subscription exists onchain and fetch details
    console.log(`🔍 Validating onchain subscription: ${subscriptionId}`)
    let subscriptionStatus: SubscriptionStatus
    try {
      subscriptionStatus = await base.subscription.getStatus({
        id: subscriptionId,
        testnet: true,
      })
    } catch (error) {
      console.error("Failed to fetch subscription status:", error)
      return c.json({ error: "Subscription not found" }, 404)
    }

    // Check if subscription is active
    if (!subscriptionStatus.isSubscribed) {
      return c.json({ error: "Subscription is not active" }, 400)
    }

    if (!subscriptionStatus.nextPeriodStart) {
      return c.json({ error: "Invalid subscription: no next period" }, 400)
    }

    if (
      !subscriptionStatus.remainingChargeInPeriod ||
      subscriptionStatus.remainingChargeInPeriod == "0"
    ) {
      return c.json(
        { error: "Invalid subscription: no remaining charge amount" },
        400,
      )
    }

    // 4. Store in database with billing_status "pending"
    const now = new Date().toISOString()
    await c.env.SUBSCRIPTIONS.prepare(
      `INSERT INTO subscriptions (
        subscription_id,
        is_subscribed,
        billing_status,
        recurring_charge,
        period_days,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        subscriptionId,
        subscriptionStatus.isSubscribed, // true at this point since we validated
        "pending",
        subscriptionStatus.recurringCharge,
        subscriptionStatus.periodInDays || null,
        now,
        now,
      )
      .run()

    // 5. Attempt first charge
    console.log(
      `💳 Attempting first charge of $${subscriptionStatus.remainingChargeInPeriod} for subscription ${subscriptionId}`,
    )
    const chargeResult = await base.subscription.charge({
      id: subscriptionId,
      amount: subscriptionStatus.remainingChargeInPeriod,
      cdpApiKeyId: c.env.CDP_API_KEY_ID,
      cdpApiKeySecret: c.env.CDP_API_KEY_SECRET,
      cdpWalletSecret: c.env.CDP_WALLET_SECRET,
      walletName: c.env.CDP_ACCOUNT_OWNER_NAME,
      testnet: true,
    })

    if (chargeResult.success) {
      // 6. Update billing_status to "active" and set next_charge_at
      console.log(
        `✅ First charge successful for subscription ${subscriptionId}`,
      )
      const nextChargeAt = subscriptionStatus.nextPeriodStart.toISOString()

      await c.env.SUBSCRIPTIONS.prepare(
        `UPDATE subscriptions
         SET billing_status = ?, next_charge_at = ?, last_charge_at = ?, updated_at = ?
         WHERE subscription_id = ?`,
      )
        .bind("active", nextChargeAt, now, now, subscriptionId)
        .run()

      // 7. Start workflow for future charges
      console.log(
        `🔄 Starting recurring billing workflow for subscription ${subscriptionId}`,
      )

      await c.env.SUBSCRIPTION_BILLING.create({
        id: subscriptionId,
        params: { nextChargeAt },
      })

      // 8. Return subscription details from database
      const subscription = await c.env.SUBSCRIPTIONS.prepare(
        "SELECT * FROM subscriptions WHERE subscription_id = ?",
      )
        .bind(subscriptionId)
        .first()

      return c.json(
        {
          ...subscription,
          message: "Subscription created and first charge successful",
        },
        201,
      )
    } else {
      // Charge failed
      console.log(`❌ First charge failed for subscription ${subscriptionId}`)

      await c.env.SUBSCRIPTIONS.prepare(
        `UPDATE subscriptions
         SET billing_status = ?, updated_at = ?
         WHERE subscription_id = ?`,
      )
        .bind("failed", now, subscriptionId)
        .run()

      return c.json({ error: "Initial charge failed" }, 400)
    }
  } catch (error) {
    console.error("Error creating subscription:", error)
    return c.json({ error: "Failed to create subscription" }, 500)
  }
})

// Test endpoint to list all subscriptions (for debugging)
app.get("/api/subscriptions", async (c) => {
  try {
    const { results } = await c.env.SUBSCRIPTIONS.prepare(
      "SELECT * FROM subscriptions ORDER BY created_at DESC",
    ).all()

    return c.json({
      count: results.length,
      subscriptions: results,
    })
  } catch (error) {
    return c.json({ error: "Failed to fetch subscriptions" }, 500)
  }
})

export default app
