import { useNetwork } from "@app-client/hooks/useNetwork"
import { authenticatedFetch } from "@app-client/lib/fetch"
import { useEvmAddress, useGetAccessToken } from "@coinbase/cdp-hooks"
import { useQuery } from "@tanstack/react-query"

interface TokenBalance {
  amount: {
    amount: string
    decimals: number
  }
  token: {
    network: string
    symbol: string
    name: string
    contractAddress: string
  }
}

interface TokenBalancesResponse {
  balances: TokenBalance[]
}

export function useTokenBalances() {
  const { evmAddress } = useEvmAddress()
  const { getAccessToken } = useGetAccessToken()
  const { network } = useNetwork()

  return useQuery({
    queryKey: ["token-balances", evmAddress, network],
    queryFn: async () => {
      if (!evmAddress) {
        throw new Error("No EVM address available")
      }

      // Call our backend API which proxies to CDP SDK
      const response = await authenticatedFetch(
        `/api/balances/${network}/${evmAddress}`,
        { getAccessToken },
      )

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }))
        console.error("Token balances error:", {
          status: response.status,
          statusText: response.statusText,
          errorData,
        })
        throw new Error(
          `Failed to fetch token balances: ${response.statusText}`,
        )
      }

      const data = (await response.json()) as TokenBalancesResponse
      return data
    },
    enabled: !!evmAddress,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}
