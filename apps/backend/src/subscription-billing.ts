import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"

interface SubscriptionParams {
  nextChargeAt: string
}

// Mock functions for testing - replace with real implementations
const checkSubscriptionOnChain = async (): Promise<boolean> => {
  // Simulate 80% still active, 20% revoked for testing
  // In production: call base.subscription.getStatus() and check isSubscribed
  return Math.random() > 0.2
}

const processPayment = async (
  subscriptionId: string,
  amount: string,
): Promise<boolean> => {
  // Mock: 90% success rate for testing
  console.log(`   Processing payment of $${amount} for ${subscriptionId}`)
  return Math.random() > 0.1
}

export class SubscriptionBilling extends WorkflowEntrypoint<
  any,
  SubscriptionParams
> {
  async run(event: WorkflowEvent<SubscriptionParams>, step: WorkflowStep) {
    const { nextChargeAt } = event.payload
    const subscriptionId = event.instanceId

    console.log(
      `🚀 Started recurring billing workflow for subscription: ${subscriptionId}.  Next charge scheduled at: ${nextChargeAt}`,
    )

    let nextCharge = new Date(nextChargeAt)

    while (true) {
      // Sleep until next charge time
      const sleepDuration = Math.max(0, nextCharge.getTime() - Date.now())
      if (sleepDuration > 0) {
        console.log(
          `😴 Sleeping for ${sleepDuration / 1000} seconds until next charge...`,
        )
        await step.sleep(`wait_for_charge_${Date.now()}`, sleepDuration)
      }

      // Validate subscription status on-chain
      const isValid = await step.do(`validate_${Date.now()}`, async () => {
        console.log(`🔍 Validating subscription status for: ${subscriptionId}`)
        const isActive = await checkSubscriptionOnChain()

        if (!isActive) {
          console.log(
            `⛔ Subscription ${subscriptionId} is no longer active on-chain`,
          )
          return false
        }

        console.log(
          `✅ Subscription ${subscriptionId} is still active on-chain`,
        )
        return true
      })

      if (!isValid) {
        console.log(
          `❌ Stopping billing workflow: subscription ${subscriptionId} no longer active`,
        )
        throw new NonRetryableError(
          `Subscription ${subscriptionId} is no longer active`,
        )
      }

      // Process the recurring charge
      const chargeSuccess = await step.do(`charge_${Date.now()}`, async () => {
        console.log(
          `💳 Processing recurring charge for subscription: ${subscriptionId}`,
        )

        // In production: fetch recurring_charge from database
        const recurringCharge = "9.99" // Mock value

        const success = await processPayment(subscriptionId, recurringCharge)
        console.log(
          success
            ? `✅ Payment successful for subscription ${subscriptionId}`
            : `❌ Payment failed for subscription ${subscriptionId}`,
        )

        return success
      })

      // Handle charge result
      if (!chargeSuccess) {
        await step.do(`mark_failed_${Date.now()}`, async () => {
          console.log(`📝 Marking subscription ${subscriptionId} as failed`)
          // TODO: Update database with billing_status = 'failed'
        })

        throw new NonRetryableError(
          `Payment failed for subscription ${subscriptionId}`,
        )
      }

      // Schedule next charge
      await step.do(`schedule_next_${Date.now()}`, async () => {
        nextCharge = new Date(Date.now() + 30000) // 30 seconds for testing
        console.log(`📝 Next charge scheduled for ${nextCharge.toISOString()}`)
        // TODO: Update database with nextChargeAt and last_charge_at
      })

      console.log(
        `🔄 Continuing billing cycle for subscription ${subscriptionId}`,
      )
    }
  }
}
