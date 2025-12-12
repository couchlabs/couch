import { NetworkProvider } from "@app-client/contexts/NetworkContext"
import { cdpConfig } from "@app-client/lib/cdpConfig"
import { HomePage } from "@app-client/pages/HomePage"
import { CDPReactProvider } from "@coinbase/cdp-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@app-client/main.css"

const queryClient = new QueryClient()

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <CDPReactProvider config={cdpConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <HomePage />
        </NetworkProvider>
      </QueryClientProvider>
    </CDPReactProvider>
  </StrictMode>,
)
