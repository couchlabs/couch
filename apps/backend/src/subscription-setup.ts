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
    console.log(`[${subscriptionId}] - 📋 Starting setup workflow `)

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
        console.log(`[${subscriptionId}] - 🔍 Validating onchain subscription`)

        try {
          const status = await base.subscription.getStatus({
            id: subscriptionId,
            testnet: true,
          })

          // Check if subscription is active
          // A subscription is considered active if we're within the valid time bounds
          // and the permission hasn't been revoked.
          // https://github.com/base/account-sdk/blob/master/packages/account-sdk/src/interface/payment/getSubscriptionStatus.ts#L157
          if (!status.isSubscribed) {
            throw new NonRetryableError(
              `[${subscriptionId}] - ⚠️ Subscription is not active`,
            )
          }

          // TODO: validate for having the right ownership to process such subscription
          // Should be able to use subscriptionOwner to match against our address (getAccount)
          // https://github.com/base/account-sdk/commit/4b6e29fd8e735ec515bc2916818ee11b318e67a9
          console.log(
            status.isSubscribed
              ? `[${subscriptionId}] - ✅ Subscription is active onchain with $${status.remainingChargeInPeriod} remaining`
              : `[${subscriptionId}] - ⛔ Subscription ${subscriptionId} is no longer active onchain`,
          )
          return status
        } catch (error) {
          console.error(
            `[${subscriptionId}] - ⚠️ Error fetching subscription: ${error.message}`,
          )

          if (
            /the subscription was requested on/i.test(error.message) ||
            /subscription is on chain/i.test(error.message) ||
            /subscription is not for usdc/i.test(error.message) ||
            /subscription has not started yet/i.test(error.message) ||
            /not found/i.test(error.message)
          ) {
            throw new NonRetryableError(
              `[${subscriptionId}] - ⚠️ ${error.message}`,
            )
          }
          // Handle other errors as retryables (Netowrk, RPC)
          throw error
        }
      },
    )

    // Step 2: Create database record
    await step.do(
      "create_db_record",
      {
        retries: {
          limit: 3,
          delay: 500,
          backoff: "linear",
        },
        timeout: "10 seconds",
      },
      async () => {
        console.log(
          `[${subscriptionId}] - 💾 Creating database record for subscription`,
        )
        await this.env.SUBSCRIPTIONS.prepare(
          `INSERT INTO subscriptions (subscription_id, billing_status)
             VALUES (?, ?)`,
        )
          .bind(subscriptionId, "pending")
          .run()
      },
    )

    // Step 3: Process first charge
    // TODO: Abstract and resuse/share with billing workflow
    const chargeResult = await step.do(
      "first_charge",
      {
        retries: {
          limit: 5,
          delay: "2 seconds",
          backoff: "exponential",
        },
        timeout: "30 seconds",
      },
      async () => {
        console.log(
          `[${subscriptionId}] - 💳 Attempting first charge of $${subscriptionStatus.remainingChargeInPeriod}`,
        )

        try {
          const result = await base.subscription.charge({
            id: subscriptionId,
            amount: subscriptionStatus.remainingChargeInPeriod!,
            cdpApiKeyId: this.env.CDP_API_KEY_ID,
            cdpApiKeySecret: this.env.CDP_API_KEY_SECRET,
            cdpWalletSecret: this.env.CDP_WALLET_SECRET,
            walletName: this.env.CDP_WALLET_NAME,
            testnet: true,
          })

          return { ...result, error: null }
        } catch (error) {
          // For the moment within the charing step, lets retry for any error
          // TODO: Deep handling of all the cases that could go wrong here with clear strategies
          // TODO: Store in the charge table any failed attempt
          console.error(
            `[ ${subscriptionId}] - ⚠️ Error charging subscription: ${error.message}`,
          )
          throw error
        }
      },
    )

    // Record the charge attempt
    await step.do(
      "record_charge",
      {
        retries: {
          limit: 3,
          delay: 500,
          backoff: "linear",
        },
        timeout: "10 seconds",
      },
      async () => {
        await this.env.SUBSCRIPTIONS.prepare(
          `INSERT INTO charges (subscription_id, amount, success, transaction_hash, charged_by, recipient, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            chargeResult.subscriptionId,
            chargeResult.amount,
            chargeResult.success ? 1 : 0,
            chargeResult.id || null,
            chargeResult.subscriptionOwner || null,
            chargeResult.recipient || null,
            chargeResult.error || null,
          )
          .run()

        console.log(
          `[${subscriptionId}] - 📝 Recorded charge ${chargeResult.id ? `${chargeResult.id}` : ""}`,
        )
      },
    )

    // Step 4: Activate subscription or mark as failed
    if (chargeResult.success) {
      await step.do(
        "activate_subscription",
        {
          retries: {
            limit: 3,
            delay: "1 second",
            backoff: "linear",
          },
          timeout: "10 seconds",
        },
        async () => {
          console.log(
            `[${subscriptionId}] - ✅ First charge successful. TX: ${chargeResult.id}`,
          )

          // Update workflow status to 'active'
          const now = new Date().toISOString()
          const nextChargeAt = subscriptionStatus.nextPeriodStart!.toISOString()

          await this.env.SUBSCRIPTIONS.prepare(
            `UPDATE subscriptions
             SET billing_status = ?, updated_at = ?
             WHERE subscription_id = ?`,
          )
            .bind("active", now, subscriptionId)
            .run()

          console.log(`[${subscriptionId}] - ✅ Activated couch subscription`)

          // Start recurring billing workflow
          console.log(
            `[${subscriptionId}] - 🔄 Starting recurring billing workflow`,
          )

          await this.env.SUBSCRIPTION_BILLING.create({
            id: subscriptionId,
            params: { nextChargeAt },
          })
        },
      )

      console.log(`[${subscriptionId}] - 🎉 Setup workflow completed`)
      return { subscriptionId, status: "activated" }
    }

    await step.do(
      "mark_failed",
      {
        retries: {
          limit: 3,
          delay: 500,
          backoff: "linear",
        },
        timeout: "10 seconds",
      },
      async () => {
        console.log(`[${subscriptionId}] - ❌ First charge failed`)

        const now = new Date().toISOString()
        await this.env.SUBSCRIPTIONS.prepare(
          `UPDATE subscriptions
             SET billing_status = ?, updated_at = ?
             WHERE subscription_id = ?`,
        )
          .bind("failed", now, subscriptionId)
          .run()

        console.log(`[${subscriptionId}] - ❌ Markied subscription as failed`)
      },
    )

    console.log(
      `[${subscriptionId}] ⚠️ Setup workflow completed with failed charge`,
    )
    return { subscriptionId, status: "failed_charge" }
  }
}

// TODOS:
// - Event/Queue systems for webhook management
// - Move all errors and add error codes into single error file
// - Move validation wherever make sense into validation function with proper testing
// - Deep dive into non-happy paths like
// -- What happen if subscription active, but billing-failed, can it be restart? ie not enough fundings
// - v1 Enhancement: Consider moving initial charge to billing workflow
// -- This would allow automatic retry of failed initial charges
// -- For POC, failed setups require manual intervention
// -- Would provide unified payment handling and better recovery options
