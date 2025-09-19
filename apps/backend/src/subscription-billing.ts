import { NonRetryableError } from "cloudflare:workflows"
import { base } from "@base-org/account"

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { WorkerEnv } from "../types/api.env"

export interface SubscriptionParams {
  nextChargeAt: string
}

export class SubscriptionBilling extends WorkflowEntrypoint<
  WorkerEnv,
  SubscriptionParams
> {
  async run(event: WorkflowEvent<SubscriptionParams>, step: WorkflowStep) {
    const { nextChargeAt } = event.payload
    const subscriptionId = event.instanceId

    console.log(`[${subscriptionId}] - 🚀 Started recurring billing workflow`)

    let nextCharge = new Date(nextChargeAt)

    while (true) {
      // Sleep until next charge t
      const sleepUntil = nextCharge.getTime()
      const sleepDuration = Math.max(0, sleepUntil - Date.now())

      if (sleepDuration > 0) {
        console.log(
          `[${subscriptionId}] - 😴 Sleeping for ${Math.ceil(sleepDuration / 1000)} seconds until next charge`,
        )
        await step.sleep(`wait_for_charge_${Date.now()}`, sleepDuration)
      }

      // Validate subscription status on-chain
      const subscriptionStatus = await step.do(
        `validate_onchain_${Date.now()}`,
        {
          retries: {
            limit: 3,
            delay: "1 second",
            backoff: "exponential",
          },
          timeout: "30 seconds",
        },
        async () => {
          console.log(
            `[${subscriptionId}] - 🔍 Validating onchain subscription`,
          )

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
              // TODO: mark the subscription as inactive on ur DB
              throw new NonRetryableError(
                `[${subscriptionId}] - ⚠️ Subscription is not active`,
              )
            }

            console.log(
              status.isSubscribed
                ? `[${subscriptionId}] - ✅ Subscription is active with $${status.remainingChargeInPeriod} remaining`
                : `[${subscriptionId}] - ⛔ Subscription ${subscriptionId} is no longer active`,
            )
            return status
          } catch (error) {
            console.error(
              `[${subscriptionId}] - ⚠️ Error fetching subscription: ${error.message}`,
            )
            // Handle all errors as retryables cause we should already have handled mismatches etc during the setup
            throw error
          }
        },
      )

      // Skip charging if no allowance left in this period
      if (
        !subscriptionStatus.remainingChargeInPeriod ||
        subscriptionStatus.remainingChargeInPeriod === "0"
      ) {
        nextCharge = subscriptionStatus.nextPeriodStart
        console.log(
          `[${subscriptionId}] - 📆 No allowance remaining for this period. Next charging at ${nextCharge.toISOString()}`,
        )
        continue
      }

      // Process the recurring charge
      // TODO: Backoff & Retry strategy with webhook in case for example of not enough funds
      const chargeResult = await step.do(
        `charge_${Date.now()}`,
        {
          retries: {
            limit: 5,
            delay: "30 seconds",
            backoff: "exponential",
          },
          timeout: "30 seconds",
        },
        async () => {
          console.log(`[${subscriptionId}] - 💳 Processing recurring charge`)

          try {
            const charge = await base.subscription.charge({
              id: subscriptionId,
              amount: subscriptionStatus.remainingChargeInPeriod,
              cdpApiKeyId: this.env.CDP_API_KEY_ID,
              cdpApiKeySecret: this.env.CDP_API_KEY_SECRET,
              cdpWalletSecret: this.env.CDP_WALLET_SECRET,
              walletName: this.env.CDP_WALLET_NAME,
              testnet: true,
            })

            console.log(
              `[${subscriptionId}] - ✅ Payment successful, TX: ${charge.id}`,
            )
            nextCharge = subscriptionStatus.nextPeriodStart
            return charge
          } catch (error) {
            // For the moment within the charing step, lets retry for any error
            // TODO: Deep handling of all the cases that could go wrong here with clear strategies
            console.error(
              `[${subscriptionId}] - ⚠️ Error charging subscription: ${error.message}`,
            )
            throw error
          }
        },
      )

      // Record the charge attempt
      await step.do(
        `record_charge_${Date.now()}`,
        {
          retries: {
            limit: 3,
            delay: 500,
            backoff: "linear",
          },
          timeout: "10 seconds",
        },
        async () => {
          // // TODO: record failed attempts
          await this.env.SUBSCRIPTIONS.prepare(
            `INSERT INTO charges (subscription_id, amount, success, transaction_hash, charged_by, recipient)
               VALUES (?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              chargeResult.subscriptionId,
              chargeResult.amount,
              1, // SQLite uses 1 for true
              chargeResult.id,
              chargeResult.subscriptionOwner,
              chargeResult.recipient || null,
            )
            .run()
          console.log(
            `[${subscriptionId}] - 📝 Recorded successful charge, TX: ${chargeResult.id}`,
          )
        },
      )

      console.log(
        `[${subscriptionId}] - 📅 Next charge scheduled for ${nextCharge}`,
      )
    }
  }
}

// TODOS:
// - Handle subscription in case that the charge failed even after the retry strategy
