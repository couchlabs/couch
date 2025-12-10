import { cdpConfig } from "@app/lib/cdpConfig"
import { HomePage } from "@app/pages/HomePage"
import { CDPReactProvider } from "@coinbase/cdp-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

const queryClient = new QueryClient()

export function App() {
  return (
    <React.StrictMode>
      <CDPReactProvider config={cdpConfig}>
        <QueryClientProvider client={queryClient}>
          <HomePage />
        </QueryClientProvider>
      </CDPReactProvider>
    </React.StrictMode>
  )
}
