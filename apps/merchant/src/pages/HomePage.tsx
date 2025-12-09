import { useEvmAddress } from "@coinbase/cdp-hooks"
import { AuthButton } from "@coinbase/cdp-react/components/AuthButton"
import { ApiKeyManager } from "@/components/ApiKeyManager"
import { SubscriptionList } from "@/components/SubscriptionList"
import { WebhookManager } from "@/components/WebhookManager"
import { useAccountSync } from "../hooks/useAccountSync"

export function HomePage() {
  const { evmAddress } = useEvmAddress()
  const { isPending, isSuccess, isError, error } = useAccountSync()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <h1 className="text-3xl font-bold mb-4">Couch Merchant</h1>

          <AuthButton />

          {evmAddress && (
            <div className="mt-4">
              <p className="text-sm text-gray-600">
                Address:{" "}
                <code className="bg-gray-100 px-2 py-1 rounded font-mono text-sm">
                  {evmAddress}
                </code>
              </p>

              {isPending && (
                <p className="text-blue-600 text-sm mt-2">Syncing account...</p>
              )}
              {isSuccess && (
                <p className="text-green-600 text-sm mt-2">Account synced ✓</p>
              )}
              {isError && (
                <p className="text-red-600 text-sm mt-2">
                  Sync failed: {error?.message}
                </p>
              )}
            </div>
          )}
        </div>

        {evmAddress && isSuccess && (
          <>
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <ApiKeyManager />
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <WebhookManager />
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <SubscriptionList />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
