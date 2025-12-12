import { useNetwork } from "@app-client/hooks/useNetwork"
import { useCurrentUser, useSendUserOperation } from "@coinbase/cdp-hooks"
import { useState } from "react"
import { type Address, encodeFunctionData, parseUnits } from "viem"

interface SendMoneyModalProps {
  isOpen: boolean
  onClose: () => void
}

// USDC contract addresses
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

// ERC20 transfer ABI (just the transfer function)
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const

export function SendMoneyModal({ isOpen, onClose }: SendMoneyModalProps) {
  const [recipient, setRecipient] = useState("")
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string>()

  const { network, isTestnet } = useNetwork()
  const { currentUser } = useCurrentUser()
  const { sendUserOperation, data } = useSendUserOperation()

  const smartAccount = currentUser?.evmSmartAccounts?.[0]
  const isPending = data?.status === "pending"
  const isSuccess = data?.status === "complete"

  // Validate inputs
  const isValidRecipient = recipient.startsWith("0x") && recipient.length === 42
  const isValidAmount = amount && parseFloat(amount) > 0

  const handleSend = async () => {
    if (!isValidRecipient || !isValidAmount || !smartAccount) {
      return
    }

    try {
      const amountInUnits = parseUnits(amount, 6)
      const usdcContract = isTestnet ? USDC_BASE_SEPOLIA : USDC_BASE_MAINNET

      // Encode the USDC transfer call
      const txData = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [recipient as Address, amountInUnits],
      })

      // Send as a user operation with the smart account
      await sendUserOperation({
        evmSmartAccount: smartAccount,
        network,
        calls: [
          {
            to: usdcContract as Address,
            data: txData,
          },
        ],
      })
    } catch (err) {
      console.error("Failed to send user operation:", err)
      setError(
        err instanceof Error ? err.message : "Failed to send transaction",
      )
    }
  }

  // Reset form and close on success
  if (isSuccess && isOpen) {
    setTimeout(() => {
      setRecipient("")
      setAmount("")
      setError(undefined)
      onClose()
    }, 2000)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose()
        }
      }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Send USDC</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label
              htmlFor="recipient"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Recipient Address
            </label>
            <input
              id="recipient"
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Amount (USDC)
            </label>
            <input
              id="amount"
              type="number"
              step="0.0001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">Error: {error}</p>
            </div>
          )}

          {isSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">
                Transaction sent successfully!
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={
                isPending ||
                !isValidRecipient ||
                !isValidAmount ||
                !smartAccount
              }
            >
              {isPending ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
