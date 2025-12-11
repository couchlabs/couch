import { authenticatedFetch } from "@app-client/lib/fetch"
import {
  useCurrentUser,
  useEvmAddress,
  useGetAccessToken,
} from "@coinbase/cdp-hooks"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

export function useAccountSync() {
  const { currentUser } = useCurrentUser()
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()
  const hasTriggered = useRef(false)

  const mutation = useMutation({
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

      return response.json() as Promise<{
        address: `0x${string}`
        subscriptionOwnerAddress: `0x${string}` | null
        createdAt: string
      }>
    },
  })

  useEffect(() => {
    // Only trigger once per component lifetime
    if (
      currentUser &&
      evmAddress &&
      !hasTriggered.current &&
      !mutation.isPending
    ) {
      hasTriggered.current = true
      mutation.mutate() // No need to pass evmAddress - it's from JWT
    }
  }, [currentUser, evmAddress, mutation])

  return mutation
}
