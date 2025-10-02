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

export interface StatusResult {
  isSubscribed: boolean
  subscriptionOwner: Address
  remainingChargeInPeriod?: number
  spenderAddress: Address
}
