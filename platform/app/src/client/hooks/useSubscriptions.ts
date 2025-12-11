import { authenticatedFetch } from "@app-client/lib/fetch"
import { useEvmAddress, useGetAccessToken } from "@coinbase/cdp-hooks"
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

// Subscription response types (matching RPC types)
export interface Subscription {
  subscriptionId: string
  status: string
  beneficiaryAddress: string
  provider: string
  testnet: boolean
  createdAt: string
  modifiedAt: string
}

export interface Order {
  id: number
  type: string
  dueAt: string
  amount: string
  status: string
  orderNumber: number
  attempts: number
  periodLengthInSeconds: number
  transactionHash?: string
  failureReason?: string
  createdAt: string
}

export interface SubscriptionDetail {
  subscription: Subscription
  orders: Order[]
}

/**
 * Hook to list all subscriptions for the current user
 * Optionally filters by network (testnet vs mainnet)
 * Now with CDP JWT authentication
 */
export function useListSubscriptions(
  testnet?: boolean,
): UseQueryResult<Subscription[], Error> {
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()

  return useQuery({
    queryKey: ["subscriptions", evmAddress, testnet],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      // Build query params (no need to send address - it's in the JWT)
      const params = new URLSearchParams()
      if (testnet !== undefined) {
        params.append("testnet", String(testnet))
      }

      const queryString = params.toString()
      const url = queryString
        ? `/api/subscriptions?${queryString}`
        : "/api/subscriptions"

      // Use authenticated fetch with CDP JWT token
      const response = await authenticatedFetch(url, { getAccessToken })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error ||
            `Failed to fetch subscriptions: ${response.statusText}`,
        )
      }

      const data = await response.json<{ subscriptions: Subscription[] }>()
      return data.subscriptions
    },
    enabled: !!evmAddress,
    refetchInterval: 10000, // Poll every 10 seconds
    refetchOnWindowFocus: true, // Refetch on tab focus
  })
}

/**
 * Hook to get subscription details with all orders
 */
export function useSubscription(
  subscriptionId: string | undefined,
): UseQueryResult<SubscriptionDetail | null, Error> {
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()

  return useQuery({
    queryKey: ["subscription", subscriptionId, evmAddress],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      if (!subscriptionId) {
        throw new Error("No subscription ID provided")
      }

      // Use authenticated fetch - no address in query params
      const response = await authenticatedFetch(
        `/api/subscriptions/${subscriptionId}`,
        { getAccessToken },
      )

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error ||
            `Failed to fetch subscription: ${response.statusText}`,
        )
      }

      return response.json<SubscriptionDetail>()
    },
    enabled: !!evmAddress && !!subscriptionId,
    refetchInterval: 3000, // Poll every 3 seconds (when modal is open)
    refetchOnWindowFocus: true, // Immediate refresh on tab focus
  })
}

/**
 * Hook to revoke (cancel) a subscription
 * Invalidates subscription queries on success
 */
export function useRevokeSubscription(): UseMutationResult<
  { success: boolean },
  Error,
  { subscriptionId: string }
> {
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ subscriptionId }: { subscriptionId: string }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      // Use authenticated fetch - no address in query params
      const response = await authenticatedFetch(
        `/api/subscriptions/${subscriptionId}/revoke`,
        { getAccessToken },
        {
          method: "POST",
        },
      )

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error ||
            `Failed to revoke subscription: ${response.statusText}`,
        )
      }

      return response.json<{ success: boolean }>()
    },
    onSuccess: (_data, variables) => {
      // Invalidate both the list and the specific subscription query
      queryClient.invalidateQueries({ queryKey: ["subscriptions", evmAddress] })
      queryClient.invalidateQueries({
        queryKey: ["subscription", variables.subscriptionId, evmAddress],
      })
    },
  })
}

/**
 * Hook to create a new subscription
 * Registers an onchain subscription with the backend
 * Invalidates subscription queries on success
 */
export function useCreateSubscription(): UseMutationResult<
  { status: string },
  Error,
  {
    subscriptionId: string
    provider: "base"
    testnet: boolean
  }
> {
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      subscriptionId: string
      provider: "base"
      testnet: boolean
    }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      // Use authenticated fetch - no address in body
      const response = await authenticatedFetch(
        "/api/subscriptions",
        { getAccessToken },
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscriptionId: params.subscriptionId,
            provider: params.provider,
            testnet: params.testnet,
          }),
        },
      )

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error ||
            `Failed to create subscription: ${response.statusText}`,
        )
      }

      return response.json<{ status: string }>()
    },
    onSuccess: (_data, variables) => {
      // Invalidate subscription list queries for the current network
      queryClient.invalidateQueries({
        queryKey: ["subscriptions", evmAddress, variables.testnet],
      })
    },
  })
}
