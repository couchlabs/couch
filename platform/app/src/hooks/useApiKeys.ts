import type { ApiKeyResponse, CreateApiKeyResponse } from "@backend/rpc/main"
import { useEvmAddress } from "@coinbase/cdp-hooks"
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

// Re-export for convenience
export type { ApiKeyResponse, CreateApiKeyResponse }

/**
 * Hook to list all API keys for the current user
 */
export function useApiKeys(): UseQueryResult<ApiKeyResponse[], Error> {
  const { evmAddress } = useEvmAddress()

  return useQuery({
    queryKey: ["apiKeys", evmAddress],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch(`/api/keys?address=${evmAddress}`)

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to fetch API keys: ${response.statusText}`,
        )
      }

      const data = await response.json<{ keys: ApiKeyResponse[] }>()
      return data.keys
    },
    enabled: !!evmAddress,
  })
}

/**
 * Hook to create a new API key
 */
export function useCreateApiKey(): UseMutationResult<
  CreateApiKeyResponse,
  Error,
  { name: string }
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: evmAddress, name }),
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to create API key: ${response.statusText}`,
        )
      }

      return response.json<CreateApiKeyResponse>()
    },
    onSuccess: () => {
      // Invalidate the list query to refetch
      queryClient.invalidateQueries({ queryKey: ["apiKeys", evmAddress] })
    },
  })
}

/**
 * Hook to update an API key (name and/or enabled status)
 */
export function useUpdateApiKey(): UseMutationResult<
  ApiKeyResponse,
  Error,
  { keyId: number; name?: string; enabled?: boolean }
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      keyId,
      name,
      enabled,
    }: {
      keyId: number
      name?: string
      enabled?: boolean
    }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch(`/api/keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: evmAddress, name, enabled }),
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to update API key: ${response.statusText}`,
        )
      }

      return response.json<ApiKeyResponse>()
    },
    onSuccess: () => {
      // Invalidate the list query to refetch
      queryClient.invalidateQueries({ queryKey: ["apiKeys", evmAddress] })
    },
  })
}

/**
 * Hook to delete an API key
 */
export function useDeleteApiKey(): UseMutationResult<
  { success: boolean },
  Error,
  { keyId: number }
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ keyId }: { keyId: number }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch(`/api/keys/${keyId}?address=${evmAddress}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to delete API key: ${response.statusText}`,
        )
      }

      return response.json<{ success: boolean }>()
    },
    onSuccess: () => {
      // Invalidate the list query to refetch
      queryClient.invalidateQueries({ queryKey: ["apiKeys", evmAddress] })
    },
  })
}
