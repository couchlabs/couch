import { subscribe as baseSubscribe } from "@base-org/account/browser"

/**
 * Configuration for Couch SDK
 */
export interface CouchSDKConfig {
  /**
   * The Couch backend API URL
   * @default 'https://api.cou.ch/v1'
   */
  apiUrl?: string
}

/**
 * Options for creating a subscription
 */
export interface SubscribeOptions {
  /**
   * The merchant's Ethereum address
   */
  merchantAddress: `0x${string}`

  /**
   * Amount to charge in USDC (e.g., "10.00")
   */
  recurringCharge: string

  /**
   * Whether this is on testnet (Base Sepolia)
   * @default false
   */
  testnet?: boolean

  /**
   * Period in days (mainnet only)
   * Must be at least 1 day
   */
  periodInDays?: number

  /**
   * Period in seconds (testnet only)
   * Allows for shorter periods for testing
   */
  overridePeriodInSecondsForTestnet?: number
}

/**
 * Result of a successful subscription creation
 */
export interface SubscriptionResult {
  /**
   * The subscription ID (permission hash)
   */
  id: `0x${string}`

  /**
   * The subscription owner address (who processes payments)
   */
  subscriptionOwner: `0x${string}`

  /**
   * Status from backend activation
   */
  status: "processing" | "active"
}

/**
 * Default Couch backend API URL
 */
const DEFAULT_API_URL = "https://api.cou.ch/v1"

/**
 * Global SDK configuration
 */
let config: CouchSDKConfig = {
  apiUrl: DEFAULT_API_URL,
}

/**
 * Configure the Couch SDK
 *
 * @param options - Configuration options
 *
 * @example
 * ```typescript
 * import { configure } from '@couchlabs/sdk'
 *
 * configure({
 *   apiUrl: 'http://localhost:3000/v1' // Use local backend
 * })
 * ```
 */
export function configure(options: CouchSDKConfig): void {
  config = { ...config, ...options }
}

/**
 * Create a recurring subscription
 *
 * This is a thin wrapper around Base SDK's subscribe() that
 * 1. Fetches merchant connfiguration from couch api
 * 2. Creates the subscription onchain using Base SDK
 * 3. Activates the subscription with Couch backend for processing
 *
 * @param options - Subscription options
 * @returns The created subscription
 * @throws Error if any step fails
 *
 * @example
 * ```typescript
 * import { subscribe } from '@couchlabs/sdk'
 *
 * // Create a subscription on mainnet
 * const subscription = await subscribe({
 *   merchantAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
 *   recurringCharge: '10.00', // $10 USDC
 *   periodInDays: 30, // Monthly
 * })
 *
 * console.log('Subscription created:', subscription.id)
 * ```
 *
 * @example
 * ```typescript
 * // Create a subscription on testnet with custom period
 * const subscription = await subscribe({
 *   merchantAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb8',
 *   recurringCharge: '0.01',
 *   testnet: true,
 *   overridePeriodInSecondsForTestnet: 60, // 1 minute for testing
 * })
 * ```
 */
export async function subscribe(
  options: SubscribeOptions,
): Promise<SubscriptionResult> {
  const {
    merchantAddress,
    recurringCharge,
    testnet = false,
    periodInDays,
    overridePeriodInSecondsForTestnet,
  } = options

  const apiUrl = config.apiUrl || DEFAULT_API_URL

  try {
    const configResponse = await fetch(
      `${apiUrl}/merchant/${merchantAddress}/config`,
    )

    if (!configResponse.ok) {
      const error = await configResponse.json().catch(() => ({}))
      throw new Error(
        error.error ||
          `Failed to fetch merchant config: ${configResponse.statusText}`,
      )
    }

    const { subscriptionOwnerAddress } = (await configResponse.json()) as {
      subscriptionOwnerAddress: `0x${string}`
    }

    // Create subscription onchain via Base SDK
    const subscription = await baseSubscribe(
      testnet
        ? {
            recurringCharge,
            subscriptionOwner: subscriptionOwnerAddress,
            testnet: true,
            overridePeriodInSecondsForTestnet:
              overridePeriodInSecondsForTestnet || 86400, // Default to 1 day
          }
        : {
            recurringCharge,
            subscriptionOwner: subscriptionOwnerAddress,
            testnet: false,
            periodInDays: periodInDays || 30, // Default to 30 days
          },
    )

    if (!subscription?.id) {
      throw new Error("Failed to create subscription onchain")
    }

    // Step 3: Activate subscription with backend
    const activateResponse = await fetch(
      `${apiUrl}/merchant/${merchantAddress}/subscription`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hash: subscription.id,
          testnet,
          provider: "base",
        }),
      },
    )

    if (!activateResponse.ok) {
      const error = await activateResponse.json().catch(() => ({}))
      throw new Error(
        error.error ||
          `Failed to activate subscription: ${activateResponse.statusText}`,
      )
    }

    const { status } = (await activateResponse.json()) as { status: string }

    return {
      id: subscription.id as `0x${string}`,
      subscriptionOwner: subscriptionOwnerAddress,
      status: status as "processing" | "active",
    }
  } catch (error) {
    // Re-throw with better error message
    if (error instanceof Error) {
      throw error
    }
    throw new Error("Unknown error creating subscription")
  }
}
