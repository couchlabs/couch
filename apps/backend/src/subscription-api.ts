import { Hono } from "hono"
import { cors } from "hono/cors"
import { isHash } from "viem"
import { base, ChargeResult } from "@base-org/account"

import { WorkerEnv } from "../types/api.env"

const app = new Hono<{ Bindings: WorkerEnv }>()
app.use(cors())

app.post("/api/subscriptions", async (ctx) => {
  const db = ctx.env.DB
  const testnet = ctx.env.STAGE === "dev"

  const body = await ctx.req.json().catch(() => null)
  const subscriptionId = body?.subscription_id

  // Validate mandatory fields
  if (!subscriptionId) {
    return ctx.json({ error: "subscription_id is required" }, 400)
  }

  // Validate subscription_id format (must be 32-byte hash)
  if (!isHash(subscriptionId)) {
    return ctx.json(
      { error: "Invalid subscription_id format. Must be a 32-byte hash" },
      400,
    )
  }

  let subscription = null
  let billingEntryId = null
  let transaction: ChargeResult | null = null
  let shouldCleanup = false
  let errorResponse = null

  console.log(`[${subscriptionId}] - 📋 Starting subscription creation`)

  try {
    // Step 1: First fetch subscription status
    console.log(`[${subscriptionId}] - 🔍 Validating onchain subscription`)

    subscription = await base.subscription.getStatus({
      id: subscriptionId,
      testnet,
    })

    if (!subscription.isSubscribed) {
      console.log(`[${subscriptionId}] - ⛔ Subscription not active onchain`)
      return ctx.json({ error: "Permission not active" }, 422)
    }

    console.log(
      `[${subscriptionId}] - ✅ Subscription is active onchain with $${subscription.remainingChargeInPeriod} remaining`,
    )

    // Step 2: Insert subscription with 'processing' status (atomic lock)
    console.log(`[${subscriptionId}] - 💾 Creating database record`)
    const insertResult = await db
      .prepare(
        `INSERT OR IGNORE INTO subscriptions (subscription_id, account_address, status)
       VALUES (?, ?, 'processing')`,
      )
      .bind(subscriptionId, subscription.subscriptionOwner)
      .run()

    if (insertResult.meta.changes === 0) {
      // No rows inserted, subscription already exists
      console.log(`[${subscriptionId}] - ⚠️ Subscription already exists`)
      return ctx.json({ error: "Subscription already exists" }, 409)
    }

    // Mark that we need cleanup if anything fails from here
    shouldCleanup = true

    // Step 3: Create initial billing entry
    console.log(`[${subscriptionId}] - 📝 Creating initial billing entry`)
    const billingResult = await db
      .prepare(
        `INSERT INTO billing_entries (
          subscription_id, type, due_at, amount, status
        ) VALUES (?, 'recurring', datetime('now'), ?, 'processing')
        RETURNING id`,
      )
      .bind(subscriptionId, subscription.remainingChargeInPeriod)
      .first()

    billingEntryId = billingResult.id

    // Step 4: Execute first charge via CDP
    console.log(
      `[${subscriptionId}] - 💳 Processing first charge of $${subscription.remainingChargeInPeriod}`,
    )

    try {
      transaction = await base.subscription.charge({
        id: subscriptionId,
        amount: subscription.remainingChargeInPeriod!,
        cdpApiKeyId: ctx.env.CDP_API_KEY_ID,
        cdpApiKeySecret: ctx.env.CDP_API_KEY_SECRET,
        cdpWalletSecret: ctx.env.CDP_WALLET_SECRET,
        walletName: ctx.env.CDP_WALLET_NAME,
        testnet,
      })
    } catch (chargeError) {
      console.error(
        `[${subscriptionId}] - ❌ Charge failed:`,
        chargeError.message,
      )
      errorResponse = {
        status: 402,
        body: { error: "Payment failed", details: chargeError.message },
      }
      throw chargeError
    }

    // Step 5: Create transaction record and mark billing entry as completed
    console.log(
      `[${subscriptionId}] - ✅ Charge successful: ${transaction.id} for $${transaction.amount}`,
    )

    // Step 6: Create next billing entry
    console.log(
      `[${subscriptionId}] - 📅 Scheduling next charge for ${subscription.nextPeriodStart.toISOString()}`,
    )

    // Step 7: Batch all success operations for atomicity
    console.log(`[${subscriptionId}] - 💾 Finalizing subscription activation`)
    await db.batch([
      // Create transaction record
      db
        .prepare(
          `INSERT INTO transactions (
            billing_entry_id, subscription_id, tx_hash, amount, status
          ) VALUES (?, ?, ?, ?, 'confirmed')`,
        )
        .bind(
          billingEntryId,
          transaction.subscriptionId,
          transaction.id,
          transaction.amount,
        ),
      // Mark billing entry as completed
      db
        .prepare(
          `UPDATE billing_entries
           SET status = 'completed'
           WHERE id = ?`,
        )
        .bind(billingEntryId),
      // Create next billing entry
      db
        .prepare(
          `INSERT INTO billing_entries (
            subscription_id, type, due_at, amount, status
          ) VALUES (?, 'recurring', ?, ?, 'pending')`,
        )
        .bind(
          subscriptionId,
          subscription.nextPeriodStart.toISOString(),
          subscription.recurringCharge,
        ),
      // Update subscription to 'active'
      db
        .prepare(
          "UPDATE subscriptions SET status = 'active' WHERE subscription_id = ?",
        )
        .bind(subscriptionId),
    ])

    console.log(`[${subscriptionId}] - 🎉 Subscription activated successfully`)

    return ctx.json(
      {
        data: {
          subscription_id: subscriptionId,
          transaction_hash: transaction.id,
          next_billing_date: subscription.nextPeriodStart.toISOString(),
        },
      },
      202,
    )
  } catch (error) {
    console.error(
      `[${subscriptionId}] - ⚠️ Subscription creation error:`,
      error.message || error,
    )

    // Only cleanup if we've started creating records
    if (shouldCleanup) {
      // Complete cleanup on any error
      try {
        // Delete all related records
        await db.batch([
          db
            .prepare("DELETE FROM transactions WHERE subscription_id = ?")
            .bind(subscriptionId),
          db
            .prepare("DELETE FROM billing_entries WHERE subscription_id = ?")
            .bind(subscriptionId),
          db
            .prepare("DELETE FROM subscriptions WHERE subscription_id = ?")
            .bind(subscriptionId),
        ])
      } catch (cleanupError) {
        console.error(
          `[${subscriptionId}] - ⚠️ Database cleanup error:`,
          cleanupError,
        )
      }

      // Attempt to revoke permission
      try {
        console.log(
          `[${subscriptionId}] - 🔄 Should be attempting to revoke permission - Currently disabled as it 500`,
        )
        //   const cdp = new CdpClient({
        //     apiKeyId: ctx.env.CDP_API_KEY_ID,
        //     apiKeySecret: ctx.env.CDP_API_KEY_SECRET,
        //     walletSecret: ctx.env.CDP_WALLET_SECRET,
        //   })
        //    const revokeResult = await cdp.evm.revokeSpendPermission({...})
      } catch (revokeError) {
        console.error(
          `[${subscriptionId}] - ❌ Revoke error details: ${revokeError.message}`,
        )
      }
    }

    // Return appropriate error response
    if (errorResponse) {
      return ctx.json(errorResponse.body, errorResponse.status)
    }

    return ctx.json({ error: "Internal server error" }, 500)
  }
})

export default app
