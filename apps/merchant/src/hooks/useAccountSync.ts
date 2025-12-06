import { useCurrentUser, useEvmAddress } from "@coinbase/cdp-hooks"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

export function useAccountSync() {
  const { currentUser } = useCurrentUser()
  const { evmAddress } = useEvmAddress()
  const hasTriggered = useRef(false)

  const mutation = useMutation({
    mutationFn: async ({ evmAddress }: { evmAddress: string }) => {
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: evmAddress }),
      })

      if (!response.ok) {
        throw new Error(`Account sync failed: ${response.statusText}`)
      }

      return response.json() as Promise<{ success: boolean }>
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
      mutation.mutate({ evmAddress })
    }
  }, [currentUser, evmAddress, mutation])

  return mutation
}
