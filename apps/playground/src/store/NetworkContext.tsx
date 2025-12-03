import { createContext, type ReactNode, useContext, useState } from "react"

export type Network = "testnet" | "mainnet"

interface NetworkContextType {
  network: Network
  setNetwork: (network: Network) => void
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined)

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network>("testnet") // Default to testnet

  return (
    <NetworkContext.Provider value={{ network, setNetwork }}>
      {children}
    </NetworkContext.Provider>
  )
}

export function useNetwork() {
  const context = useContext(NetworkContext)
  if (!context) {
    throw new Error("useNetwork must be used within NetworkProvider")
  }
  return context
}
