import { useEvmAddress } from "@coinbase/cdp-hooks"
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
 */
export function useListSubscriptions(
  testnet?: boolean,
): UseQueryResult<Subscription[], Error> {
  const { evmAddress } = useEvmAddress()

  return useQuery({
    queryKey: ["subscriptions", evmAddress, testnet],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const params = new URLSearchParams({ address: evmAddress })
      if (testnet !== undefined) {
        params.append("testnet", String(testnet))
      }

      const response = await fetch(`/api/subscriptions?${params}`)

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
  })
}

/**
 * Hook to get subscription details with all orders
 */
export function useSubscription(
  subscriptionId: string | undefined,
): UseQueryResult<SubscriptionDetail | null, Error> {
  const { evmAddress } = useEvmAddress()

  return useQuery({
    queryKey: ["subscription", subscriptionId, evmAddress],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      if (!subscriptionId) {
        throw new Error("No subscription ID provided")
      }

      const response = await fetch(
        `/api/subscriptions/${subscriptionId}?address=${evmAddress}`,
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
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ subscriptionId }: { subscriptionId: string }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch(
        `/api/subscriptions/${subscriptionId}/revoke?address=${evmAddress}`,
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
