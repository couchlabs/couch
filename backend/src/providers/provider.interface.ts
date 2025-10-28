import type { Address, Hash } from "viem"

// Provider enum aligned with database CHECK constraint
// Currently only support 'base'
export enum Provider {
  BASE = "base",
}

export interface SubscriptionProvider {
  readonly providerId: Provider

  chargeSubscription(params: ChargeParams): Promise<ChargeResult>
  getSubscriptionStatus(params: StatusParams): Promise<StatusResult>
  validateSubscriptionId(id: string): boolean
}

export interface ChargeParams {
  subscriptionId: string
  amount: string
  recipient: Address
}

export interface ChargeResult {
  transactionHash: Hash
  success: boolean
  gasUsed?: string
}

export interface StatusParams {
  subscriptionId: string
}

// TODO: Revisit this type when adding second provider
// Current design is based on Base SDK behavior - may need adjustment
// to be truly generic across different provider implementations

/**
 * Discriminated union representing two distinct states:
 * 1. Permission not found in indexer (minimal data)
 * 2. Permission found (full subscription data, may be active or inactive)
 */
export type StatusResult =
  | {
      permissionExists: false
      isSubscribed: false
      recurringCharge: string // Always '0' when permission not found
      spenderAddress: Address
    }
  | {
      permissionExists: true
      isSubscribed: boolean // true if active, false if revoked/expired
      subscriptionOwner: Address
      remainingChargeInPeriod: string
      currentPeriodStart: Date
      nextPeriodStart?: Date // Optional - undefined means no future recurring charges
      recurringCharge: string
      periodInDays: number
      spenderAddress: Address
    }
