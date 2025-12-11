import { cdpConfig } from "@app-client/lib/cdpConfig"
import { HomePage } from "@app-client/pages/HomePage"
import { CDPReactProvider } from "@coinbase/cdp-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const queryClient = new QueryClient()

export function App() {
  return (
    <CDPReactProvider config={cdpConfig}>
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>
    </CDPReactProvider>
  )
}
