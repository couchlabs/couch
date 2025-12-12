import { useTokenBalances } from "@app-client/hooks/useTokenBalances"
import { useEvmAddress } from "@coinbase/cdp-hooks"
import { CopyAddress } from "@coinbase/cdp-react/components/CopyAddress"
import { SignOutButton } from "@coinbase/cdp-react/components/SignOutButton"

interface WalletCardProps {
  onSendMoney: () => void
  onExportKeys: () => void
}

export function WalletCard({ onSendMoney, onExportKeys }: WalletCardProps) {
  const { evmAddress } = useEvmAddress()
  const { data: tokenBalances, isLoading } = useTokenBalances()

  // Find USDC balance
  const usdcBalance = tokenBalances?.balances.find(
    (balance) => balance.token.symbol === "USDC",
  )

  // Format USDC balance for display
  const formatUsdcBalance = () => {
    if (isLoading) return "Loading..."
    if (!usdcBalance) return "$0.0000"

    const amount = Number.parseFloat(usdcBalance.amount.amount)
    const decimals = usdcBalance.amount.decimals
    const formattedAmount = (amount / 10 ** decimals).toFixed(4)
    return `$${formattedAmount}`
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
      {/* Address section */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Wallet Address</div>
        {evmAddress && <CopyAddress address={evmAddress} />}
      </div>

      {/* Balance section */}
      <div>
        <div className="text-xs text-gray-500 mb-1">USDC Balance</div>
        <div className="text-2xl font-bold text-gray-900">
          {formatUsdcBalance()}
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-2 pt-2 border-t border-gray-200">
        <button
          type="button"
          onClick={onSendMoney}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          Send Money
        </button>
        <button
          type="button"
          onClick={onExportKeys}
          className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
        >
          Export Keys
        </button>
        <div className="pt-2">
          <SignOutButton />
        </div>
      </div>
    </div>
  )
}
