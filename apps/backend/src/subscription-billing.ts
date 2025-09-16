import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"

interface SubscriptionParams {
  subscription_id: string
  next_charge_at: string
}

interface MockSubscription {
  payer_address: string
  owner_address: string
  recurring_charge: string
  period_days: number
}

// Mock functions for testing - replace with real implementations
const getMockOnChainStatus = (): "active" | "revoked" => {
  // Simulate 80% active, 20% revoked for testing
  return Math.random() > 0.2 ? "active" : "revoked"
}

const getMockSubscription = (subscriptionId: string): MockSubscription => ({
  payer_address: "0xabcdef1234567890abcdef1234567890abcdef12",
  owner_address: "0x1234567890abcdef1234567890abcdef12345678",
  recurring_charge: "9.99",
  period_days: 30,
})

const processPayment = async (
  subscription: MockSubscription,
): Promise<boolean> => {
  // Mock: 90% success rate for testing
  return Math.random() > 0.1
}

export class SubscriptionBilling extends WorkflowEntrypoint<
  any,
  SubscriptionParams
> {
  async run(event: WorkflowEvent<SubscriptionParams>, step: WorkflowStep) {
    const { subscription_id, next_charge_at } = event.payload

    console.log(
      `🚀 Starting recurring billing workflow for subscription: ${subscription_id}`,
    )
    console.log(`   Next charge scheduled at: ${next_charge_at}`)

    let nextCharge = new Date(next_charge_at)

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
        console.log(`🔍 Validating subscription status for: ${subscription_id}`)
        const status = getMockOnChainStatus()

        if (status === "revoked") {
          console.log(
            `⛔ Subscription ${subscription_id} has been revoked on-chain`,
          )
          return false
        }

        console.log(`✅ Subscription ${subscription_id} is active on-chain`)
        return true
      })

      if (!isValid) {
        console.log(
          `❌ Stopping billing workflow: subscription ${subscription_id} revoked`,
        )
        throw new NonRetryableError(
          `Subscription ${subscription_id} has been revoked`,
        )
      }

      // Process the recurring charge
      const chargeSuccess = await step.do(`charge_${Date.now()}`, async () => {
        console.log(
          `💳 Processing recurring charge for subscription: ${subscription_id}`,
        )

        const subscription = getMockSubscription(subscription_id)
        console.log(`   Amount: $${subscription.recurring_charge}`)
        console.log(`   From: ${subscription.payer_address}`)
        console.log(`   To: ${subscription.owner_address}`)

        const success = await processPayment(subscription)
        console.log(
          success
            ? `✅ Payment successful for subscription ${subscription_id}`
            : `❌ Payment failed for subscription ${subscription_id}`,
        )

        return success
      })

      // Handle charge result
      if (!chargeSuccess) {
        await step.do(`mark_failed_${Date.now()}`, async () => {
          console.log(`📝 Marking subscription ${subscription_id} as failed`)
          // TODO: Update database with billing_status = 'failed'
        })

        throw new NonRetryableError(
          `Payment failed for subscription ${subscription_id}`,
        )
      }

      // Schedule next charge
      await step.do(`schedule_next_${Date.now()}`, async () => {
        nextCharge = new Date(Date.now() + 30000) // 30 seconds for testing
        console.log(`📝 Next charge scheduled for ${nextCharge.toISOString()}`)
        // TODO: Update database with next_charge_at and last_charge_at
      })

      console.log(
        `🔄 Continuing billing cycle for subscription ${subscription_id}`,
      )
    }
  }
}
