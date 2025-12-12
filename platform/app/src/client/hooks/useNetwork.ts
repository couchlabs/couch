import { NetworkContext } from "@app-client/contexts/NetworkContext"
import { useContext } from "react"

export function useNetwork() {
  const context = useContext(NetworkContext)

  if (!context) {
    throw new Error("useNetwork must be used within a NetworkProvider")
  }

  return context
}
