import { useEvmAddress } from "@coinbase/cdp-hooks"
import {
  type UseMutationResult,
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

// Webhook response types
export interface Webhook {
  id: number
  url: string
  secretPreview: string
  enabled: boolean
  createdAt: string
  lastUsedAt?: string
}

export interface CreatedWebhook {
  url: string
  secret: string
}

/**
 * Hook to get webhook configuration for the current user
 */
export function useWebhook(): UseQueryResult<Webhook | null, Error> {
  const { evmAddress } = useEvmAddress()

  return useQuery({
    queryKey: ["webhook", evmAddress],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch(`/api/webhook?address=${evmAddress}`)

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to fetch webhook: ${response.statusText}`,
        )
      }

      return response.json<Webhook | null>()
    },
    enabled: !!evmAddress,
  })
}

/**
 * Hook to create/update a webhook
 * Returns the full secret on success (one-time reveal)
 */
export function useCreateWebhook(): UseMutationResult<
  CreatedWebhook,
  Error,
  { url: string }
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch("/api/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: evmAddress, url }),
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to create webhook: ${response.statusText}`,
        )
      }

      return response.json<CreatedWebhook>()
    },
    onSuccess: () => {
      // Invalidate the webhook query to refetch
      queryClient.invalidateQueries({ queryKey: ["webhook", evmAddress] })
    },
  })
}

/**
 * Hook to update webhook URL only (keeps existing secret)
 */
export function useUpdateWebhookUrl(): UseMutationResult<
  { url: string },
  Error,
  { url: string }
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch("/api/webhook/url", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: evmAddress, url }),
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error ||
            `Failed to update webhook URL: ${response.statusText}`,
        )
      }

      return response.json<{ url: string }>()
    },
    onSuccess: () => {
      // Invalidate the webhook query to refetch
      queryClient.invalidateQueries({ queryKey: ["webhook", evmAddress] })
    },
  })
}

/**
 * Hook to rotate webhook secret only (keeps existing URL)
 * Returns the new secret (one-time reveal)
 */
export function useRotateWebhookSecret(): UseMutationResult<
  { secret: string },
  Error,
  void
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch("/api/webhook/rotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: evmAddress }),
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error ||
            `Failed to rotate webhook secret: ${response.statusText}`,
        )
      }

      return response.json<{ secret: string }>()
    },
    onSuccess: () => {
      // Invalidate the webhook query to refetch
      queryClient.invalidateQueries({ queryKey: ["webhook", evmAddress] })
    },
  })
}

/**
 * Hook to delete webhook configuration
 */
export function useDeleteWebhook(): UseMutationResult<
  { success: boolean },
  Error,
  void
> {
  const { evmAddress } = useEvmAddress()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      const response = await fetch(`/api/webhook?address=${evmAddress}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json<{ error?: string }>()
        throw new Error(
          errorData.error || `Failed to delete webhook: ${response.statusText}`,
        )
      }

      return response.json<{ success: boolean }>()
    },
    onSuccess: () => {
      // Invalidate the webhook query to refetch
      queryClient.invalidateQueries({ queryKey: ["webhook", evmAddress] })
    },
  })
}
