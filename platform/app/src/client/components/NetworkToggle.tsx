import { useNetwork } from "@app-client/hooks/useNetwork"

export function NetworkToggle() {
  const { isTestnet, toggleNetwork } = useNetwork()

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600">Testnet</span>
      <button
        type="button"
        onClick={toggleNetwork}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full transition-colors
          ${isTestnet ? "bg-blue-600" : "bg-gray-600"}
        `}
        role="switch"
        aria-checked={isTestnet}
        aria-label="Toggle network"
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
            ${isTestnet ? "translate-x-6" : "translate-x-1"}
          `}
        />
      </button>
    </div>
  )
}
