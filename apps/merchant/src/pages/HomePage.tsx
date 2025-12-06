import { useEvmAddress } from "@coinbase/cdp-hooks"
import { AuthButton } from "@coinbase/cdp-react/components/AuthButton"

export function HomePage() {
  const { evmAddress } = useEvmAddress()

  return (
    <div className="p-4">
      <AuthButton />
      {evmAddress && (
        <div>
          Address: <pre>{evmAddress}</pre>
        </div>
      )}
    </div>
  )
}
