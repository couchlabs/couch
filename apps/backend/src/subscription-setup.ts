import { NonRetryableError } from "cloudflare:workflows"
import { base, SubscriptionStatus } from "@base-org/account"

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { WorkerEnv } from "../types/api.env"

export interface SetupParams {
  subscriptionId: string
}

export class SubscriptionSetup extends WorkflowEntrypoint<
  WorkerEnv,
  SetupParams
> {
  async run(event: WorkflowEvent<SetupParams>, step: WorkflowStep) {
    const { subscriptionId } = event.payload

    console.log(
      `📋 Starting setup workflow for subscription: ${subscriptionId}`,
    )

    // Step 1: Validate onchain subscription status
    const subscriptionStatus = await step.do(
      "validate_onchain",
      {
        retries: {
          limit: 3,
          delay: "1 second",
          backoff: "exponential",
        },
        timeout: "30 seconds",
      },
      async () => {
        console.log(`🔍 Validating onchain subscription: ${subscriptionId}`)

        let status: SubscriptionStatus
        try {
          status = await base.subscription.getStatus({
            id: subscriptionId,
            testnet: true,
          })
        } catch (error) {
          console.error("Failed to fetch subscription status:", error)

          const errorMessage = error.message?.toLowerCase()
          // Determine if this is a permanent error (don't retry) or transient (retry)
          // These are configuration/setup errors - permanent, don't retry
          if (
            errorMessage.includes("testnet but is actually a mainnet") ||
            errorMessage.includes("mainnet but is actually a testnet") ||
            errorMessage.includes("not for usdc token") ||
            errorMessage.includes("has not started yet")
          ) {
            throw new NonRetryableError(
              `${errorMessage} - Subscription ID: ${subscriptionId}`,
            )
          }

          // Network/RPC errors - trigger retry based on workflow retry policy
          console.log(
            `⚠️ Network error for subscription ${subscriptionId}: ${error.message} - Will retry.`,
          )
          throw error
        }

        // Check if subscription exists and is valid
        if (!status.isSubscribed) {
          if (status.recurringCharge === "0") {
            throw new NonRetryableError(
              `Subscription ${subscriptionId} not found. Please verify the subscription ID is correct.`,
            )
          }
          // If we have recurringCharge, subscription exists but is inactive
          throw new NonRetryableError(
            `Subscription ${subscriptionId} is not active. It may have expired or been cancelled.`,
          )
        }

        // Validation for subscription configuration
        if (!status.nextPeriodStart) {
          throw new NonRetryableError(
            `Subscription ${subscriptionId} has invalid configuration: no next billing period defined.`,
          )
        }
        if (
          !status.remainingChargeInPeriod ||
          status.remainingChargeInPeriod == "0"
        ) {
          throw new NonRetryableError(
            `Subscription ${subscriptionId} has no remaining allowance for this period. The maximum charge amount may have been reached.`,
          )
        }
        // TODO: validate for having the right ownership to process such subscription

        return status
      },
    )

    // Step 2: Create database record
    // TODO: Configure retry policy for database operations
    // - Max retries: 3
    // - Backoff: linear (500ms)
    // - Handle duplicate key errors gracefully (idempotent)
    await step.do("create_db_record", async () => {
      console.log(
        `💾 Creating database record for subscription: ${subscriptionId}`,
      )

      const now = new Date().toISOString()
      await this.env.SUBSCRIPTIONS.prepare(
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
    })

    // Step 3: Process first charge
    // TODO: Configure retry policy for payment processing
    // - Max retries: 5
    // - Backoff: exponential with jitter (2s, 4s, 8s, 16s, 32s)
    // - Add idempotency key to prevent duplicate charges
    // - Only retry on network/timeout errors, not declined payments
    const chargeResult = await step.do("first_charge", async () => {
      console.log(
        `💳 Attempting first charge of $${subscriptionStatus.remainingChargeInPeriod} for subscription ${subscriptionId}`,
      )

      return await base.subscription.charge({
        id: subscriptionId,
        amount: subscriptionStatus.remainingChargeInPeriod!,
        cdpApiKeyId: this.env.CDP_API_KEY_ID,
        cdpApiKeySecret: this.env.CDP_API_KEY_SECRET,
        cdpWalletSecret: this.env.CDP_WALLET_SECRET,
        walletName: this.env.CDP_ACCOUNT_OWNER_NAME,
        testnet: true,
      })
    })

    // Step 4: Activate subscription or mark as failed
    if (chargeResult.success) {
      // TODO: Configure retry policy for activation
      // - Max retries: 3
      // - Backoff: linear (1s)
      // - Critical step - should rarely fail
      await step.do("activate_subscription", async () => {
        console.log(`✅ First charge successful. TX: ${chargeResult.id}`)
        console.log(`✅ Activating subscription-billing: ${subscriptionId}`)

        // Update DB status to 'active' and set next charge time
        const now = new Date().toISOString()
        const nextChargeAt = subscriptionStatus.nextPeriodStart!.toISOString()

        await this.env.SUBSCRIPTIONS.prepare(
          `UPDATE subscriptions
           SET billing_status = ?, next_charge_at = ?, last_charge_at = ?, updated_at = ?
           WHERE subscription_id = ?`,
        )
          .bind("active", nextChargeAt, now, now, subscriptionId)
          .run()

        // Start recurring billing workflow
        console.log(
          `🔄 Starting recurring billing workflow for subscription ${subscriptionId}`,
        )

        await this.env.SUBSCRIPTION_BILLING.create({
          id: subscriptionId,
          params: { nextChargeAt },
        })
      })
    } else {
      // TODO: Configure retry policy for failure marking
      // - Max retries: 3
      // - Backoff: linear (500ms)
      // - Should always succeed to prevent stuck workflows
      await step.do("mark_failed", async () => {
        console.log(`❌ First charge failed for subscription ${subscriptionId}`)
        console.log(`❌ Marking subscription as failed: ${subscriptionId}`)

        const now = new Date().toISOString()
        await this.env.SUBSCRIPTIONS.prepare(
          `UPDATE subscriptions
           SET billing_status = ?, updated_at = ?
           WHERE subscription_id = ?`,
        )
          .bind("failed", now, subscriptionId)
          .run()
      })

      throw new NonRetryableError(
        `Initial charge failed for subscription ${subscriptionId}`,
      )
    }

    console.log(
      `🎉 Setup workflow completed for subscription: ${subscriptionId}`,
    )
    return { subscriptionId, status: "activated" }
  }
}
