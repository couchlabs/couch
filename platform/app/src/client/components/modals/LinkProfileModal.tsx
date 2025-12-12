import { LinkAuthModal, LinkAuthModalContent } from "@coinbase/cdp-react"

interface LinkProfileModalProps {
  isOpen: boolean
  onClose: () => void
}

export function LinkProfileModal({ isOpen, onClose }: LinkProfileModalProps) {
  return (
    <LinkAuthModal
      open={isOpen}
      setIsOpen={(open) => {
        if (!open) onClose()
      }}
      onLinkSuccess={(method) => {
        console.log(`Successfully linked ${method}`)
      }}
    >
      <LinkAuthModalContent />
    </LinkAuthModal>
  )
}
