import { useEvmSmartAccounts } from "@coinbase/cdp-hooks"
import {
  ExportWalletModal,
  ExportWalletModalContent,
} from "@coinbase/cdp-react"

interface ExportKeysModalProps {
  isOpen: boolean
  onClose: () => void
  smartAccountAddress: string
}

export function ExportKeysModal({
  isOpen,
  onClose,
  smartAccountAddress,
}: ExportKeysModalProps) {
  const { evmSmartAccounts } = useEvmSmartAccounts()

  // Find the smart account and get its owner EOA address
  const smartAccount = evmSmartAccounts?.find(
    (account) => account.address === smartAccountAddress,
  )
  const eoaAddress = smartAccount?.ownerAddresses?.[0]

  if (!eoaAddress) {
    return null
  }

  return (
    <ExportWalletModal
      address={eoaAddress}
      open={isOpen}
      setIsOpen={(open) => {
        if (!open) onClose()
      }}
      onCopySuccess={() => {
        console.log("Successfully copied EOA keys")
      }}
    >
      <ExportWalletModalContent />
    </ExportWalletModal>
  )
}
