import { useEvmAddress } from "@coinbase/cdp-hooks"
import { AuthButton } from "@coinbase/cdp-react/components/AuthButton"
import { useAccountSync } from "../hooks/useAccountSync"

export function HomePage() {
  const { evmAddress } = useEvmAddress()
  const { isPending, isSuccess, isError, error } = useAccountSync()

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Couch Merchant</h1>

      <AuthButton />

      {evmAddress && (
        <div className="mt-4">
          <p>
            Address: <code className="bg-gray-100 p-1">{evmAddress}</code>
          </p>

          {isPending && <p className="text-blue-600">Syncing account...</p>}
          {isSuccess && <p className="text-green-600">Account synced ✓</p>}
          {isError && (
            <p className="text-red-600">Sync failed: {error?.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
