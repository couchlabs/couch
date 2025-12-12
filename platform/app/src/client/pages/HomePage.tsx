import { Dashboard } from "@app-client/pages/Dashboard"
import { SignInPage } from "@app-client/pages/SignInPage"
import { useCurrentUser, useIsInitialized } from "@coinbase/cdp-hooks"

export function HomePage() {
  const { isInitialized } = useIsInitialized()
  const { currentUser } = useCurrentUser()

  // Show loading state while CDP SDK initializes
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return currentUser ? <Dashboard /> : <SignInPage />
}
