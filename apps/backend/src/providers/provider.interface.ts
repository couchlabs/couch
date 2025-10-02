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

// TODO: Revisit this interface when adding second provider
// Current design is based on Base SDK behavior - may need adjustment
// to be truly generic across different provider implementations
export interface StatusResult {
  isSubscribed: boolean
  subscriptionOwner?: Address // Only when permission exists (found in indexer)
  remainingChargeInPeriod?: string // Only when permission exists
  spenderAddress: Address
  nextPeriodStart?: Date // Optional - undefined means no future recurring charges
  recurringCharge: string // Always present (defaults to '0' when not found)
}
