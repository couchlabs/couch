import { Hono } from "hono"

import { CloudflareEnv } from "../types/env"

export * from "./subscription-billing"

const app = new Hono<{ Bindings: CloudflareEnv }>()

app.post("/api/subscriptions", async (c) => {
  try {
    const body = await c.req.json()

    // 1. Validate mandatory subscription_id
    if (!body.subscription_id) {
      return c.json({ error: "subscription_id is required" }, 400)
    }

    const subscriptionId = body.subscription_id

    // 2. Check if subscription already exists in database
    const existing = await c.env.SUBSCRIPTIONS.prepare(
      "SELECT * FROM subscriptions WHERE subscription_id = ?",
    )
      .bind(subscriptionId)
      .first()

    if (existing) {
      return c.json({ error: "Subscription already exists" }, 400)
    }

    // 3. Mock: Validate subscription exists on-chain and fetch details
    console.log(`🔍 Validating on-chain subscription: ${subscriptionId}`)
    // In a real implementation, this would call the blockchain
    const mockOnChainData = {
      status: "active",
      owner_address: "0x1234567890abcdef1234567890abcdef12345678",
      payer_address: "0xabcdef1234567890abcdef1234567890abcdef12",
      recurring_charge: "9.99",
      period_days: 30,
    }

    // 4. Store in database with billing_status "pending"
    const now = new Date().toISOString()
    await c.env.SUBSCRIPTIONS.prepare(
      `INSERT INTO subscriptions (
        subscription_id,
        status,
        billing_status,
        owner_address,
        payer_address,
        recurring_charge,
        period_days,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        subscriptionId,
        mockOnChainData.status,
        "pending",
        mockOnChainData.owner_address,
        mockOnChainData.payer_address,
        mockOnChainData.recurring_charge,
        mockOnChainData.period_days,
        now,
      )
      .run()

    // 5. Mock: Attempt first charge
    console.log(
      `💳 Attempting first charge of $${mockOnChainData.recurring_charge} for subscription ${subscriptionId}`,
    )
    console.log(`   From: ${mockOnChainData.payer_address}`)
    console.log(`   To: ${mockOnChainData.owner_address}`)

    // Simulate charge success (in real implementation, this would call payment processor)
    const chargeSuccessful = true

    if (chargeSuccessful) {
      // 6. Update billing_status to "active" and set next_charge_at
      const nextChargeAt = new Date(
        Date.now() + mockOnChainData.period_days * 24 * 60 * 60 * 1000,
      ).toISOString()

      // For testing, use 30 seconds instead of 30 days
      const testNextChargeAt = new Date(Date.now() + 30000).toISOString() // 30 seconds

      await c.env.SUBSCRIPTIONS.prepare(
        `UPDATE subscriptions
         SET billing_status = ?, next_charge_at = ?
         WHERE subscription_id = ?`,
      )
        .bind("active", testNextChargeAt, subscriptionId)
        .run()

      // 7. Start workflow for future charges
      console.log(
        `🔄 Starting recurring billing workflow for subscription ${subscriptionId}`,
      )
      console.log(
        `   Next charge scheduled at: ${testNextChargeAt} (30 seconds for testing)`,
      )

      await c.env.SUBSCRIPTION_BILLING.create({
        id: subscriptionId,
        params: {
          subscription_id: subscriptionId,
          next_charge_at: testNextChargeAt,
        },
      })

      // 8. Return subscription details
      return c.json(
        {
          subscription_id: subscriptionId,
          status: mockOnChainData.status,
          billing_status: "active",
          owner_address: mockOnChainData.owner_address,
          payer_address: mockOnChainData.payer_address,
          recurring_charge: mockOnChainData.recurring_charge,
          period_days: mockOnChainData.period_days,
          next_charge_at: testNextChargeAt,
          created_at: now,
          message:
            "Subscription created successfully. Next charge in 30 seconds (for testing)",
        },
        201,
      )
    } else {
      // Charge failed
      console.log(`❌ First charge failed for subscription ${subscriptionId}`)

      await c.env.SUBSCRIPTIONS.prepare(
        `UPDATE subscriptions
         SET billing_status = ?
         WHERE subscription_id = ?`,
      )
        .bind("failed", subscriptionId)
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
