/**
 * Generates the subscription owner wallet name for an account
 * Format: merchant-{accountId}
 *
 * This name is used with getOrCreateSubscriptionOwnerWallet to create
 * or retrieve the CDP wallet that will execute subscription charges.
 *
 * @param accountId - The unique account identifier from the database
 * @returns Wallet name string in format "merchant-{accountId}"
 */
export function getSubscriptionOwnerWalletName(accountId: number): string {
  return `merchant-${accountId}`
}
