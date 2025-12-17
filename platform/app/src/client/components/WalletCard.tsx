import { useTokenBalances } from "@app-client/hooks/useTokenBalances"
import { useEvmAddress } from "@coinbase/cdp-hooks"
import { Copy } from "lucide-react"

interface WalletCardProps {
  onSendMoney: () => void
}

export function WalletCard({ onSendMoney }: WalletCardProps) {
  const { evmAddress } = useEvmAddress()
  const { data: tokenBalances, isLoading } = useTokenBalances()

  // Find USDC balance
  const usdcBalance = tokenBalances?.balances.find(
    (balance) => balance.token.symbol === "USDC",
  )

  // Format USDC balance for display
  const formatUsdcBalance = () => {
    if (isLoading) return "Loading..."
    if (!usdcBalance) return "0"

    const amount = Number.parseFloat(usdcBalance.amount.amount)
    const decimals = usdcBalance.amount.decimals
    const formattedAmount = (amount / 10 ** decimals).toFixed(2)
    return formattedAmount
  }

  return (
    <div className="bg-white rounded-t-xl border-t border-l border-r border-gray-200 p-6 space-y-4">
      {/* Balance section */}
      <div className="pb-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-blue-600 mb-3">Balance</h2>
        <div className="text-4xl font-normal text-gray-700">
          {formatUsdcBalance()}
          <span className="text-xl ml-2">USDC</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="space-y-3">
        {/* Wallet Address */}
        {evmAddress && (
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(evmAddress)}
            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-medium text-sm flex items-center justify-between cursor-pointer"
          >
            <span>
              {evmAddress.slice(0, 6)}...{evmAddress.slice(-4)}
            </span>
            <Copy className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onSendMoney}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm cursor-pointer"
        >
          Send Money
        </button>
      </div>
    </div>
  )
}
