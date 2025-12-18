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

const STORAGE_KEY = "couch:testnet"

/**
 * Load testnet preference from localStorage
 */
function getInitialTestnet(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === "true"
  } catch {
    // localStorage not available or error reading
  }
  return false
}

export function NetworkProvider({ children }: NetworkProviderProps) {
  const [isTestnet, setIsTestnet] = useState<boolean>(getInitialTestnet)

  const toggleNetwork = () => {
    setIsTestnet((prev) => {
      const next = !prev
      // Persist to localStorage
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // Silently fail if localStorage unavailable
      }
      return next
    })
  }

  const value: NetworkContextValue = {
    network: isTestnet ? "base-sepolia" : "base",
    isTestnet,
    toggleNetwork,
  }

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  )
}
