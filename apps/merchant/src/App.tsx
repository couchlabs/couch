import { CDPReactProvider } from "@coinbase/cdp-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

import { cdpConfig } from "@/lib/cdpConfig"
import { HomePage } from "@/pages/HomePage"

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
