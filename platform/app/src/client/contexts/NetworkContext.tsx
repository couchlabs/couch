import { createContext, type ReactNode, useState } from "react"

export type Network = "base" | "base-sepolia"

interface NetworkContextValue {
  network: Network
  isTestnet: boolean
  toggleNetwork: () => void
}

export const NetworkContext = createContext<NetworkContextValue | null>(null)

interface NetworkProviderProps {
  children: ReactNode
}

export function NetworkProvider({ children }: NetworkProviderProps) {
  const [network, setNetwork] = useState<Network>("base-sepolia")

  const toggleNetwork = () => {
    setNetwork((prev) => (prev === "base" ? "base-sepolia" : "base"))
  }

  const value: NetworkContextValue = {
    network,
    isTestnet: network === "base-sepolia",
    toggleNetwork,
  }

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  )
}
