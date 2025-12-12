import { authenticatedFetch } from "@app-client/lib/fetch"
import {
  useCurrentUser,
  useEvmAddress,
  useGetAccessToken,
} from "@coinbase/cdp-hooks"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

export function useAccountSync() {
  const { currentUser } = useCurrentUser()
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationKey: ["account-sync", evmAddress],
    mutationFn: async () => {
      // PUT request - idempotent account setup
      // Sets wallet address for authenticated user (safe to retry)
      const response = await authenticatedFetch(
        "/api/account",
        { getAccessToken },
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: evmAddress }),
        },
      )

      if (!response.ok) {
        throw new Error(`Account sync failed: ${response.statusText}`)
      }

      const data = await response.json()
      return data as {
        address: `0x${string}`
        subscriptionOwnerAddress: `0x${string}` | null
        createdAt: string
      }
    },
    onSuccess: (data) => {
      // Store in query cache for persistence across re-renders
      queryClient.setQueryData(["account", evmAddress], data)
    },
  })

  useEffect(() => {
    // Only trigger sync if user is authenticated and we don't have data yet
    if (currentUser && evmAddress && !mutation.data) {
      mutation.mutate()
    }
  }, [currentUser, evmAddress, mutation.data])

  return mutation
}
