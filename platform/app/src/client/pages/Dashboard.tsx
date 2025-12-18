// import { ApiKeyModal } from "@app-client/components/modals/ApiKeyModal"
import { ExportKeysModal } from "@app-client/components/modals/ExportKeysModal"
import { LinkProfileModal } from "@app-client/components/modals/LinkProfileModal"
import { SendMoneyModal } from "@app-client/components/modals/SendMoneyModal"
import { WebhookModal } from "@app-client/components/modals/WebhookModal"
import { Navigation } from "@app-client/components/Navigation"
import { NetworkToggle } from "@app-client/components/NetworkToggle"
import { SubscriptionList } from "@app-client/components/SubscriptionList"
import { WalletCard } from "@app-client/components/WalletCard"
import { useAccountSync } from "@app-client/hooks/useAccountSync"
import { useEvmAddress, useSignOut } from "@coinbase/cdp-hooks"
import { BookOpen, FileText, Key, Link, LogOut, Webhook } from "lucide-react"
import { useState } from "react"

export function Dashboard() {
  const { data: account } = useAccountSync()
  const { evmAddress } = useEvmAddress()
  const { signOut } = useSignOut()

  // Modal state
  // const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false)
  const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false)
  const [isLinkProfileModalOpen, setIsLinkProfileModalOpen] = useState(false)
  const [isSendMoneyModalOpen, setIsSendMoneyModalOpen] = useState(false)
  const [isExportKeysModalOpen, setIsExportKeysModalOpen] = useState(false)

  // Navigation items - Profile group
  const profileNavigationItems = [
    {
      id: "link-profile",
      label: "Link a Profile",
      onClick: () => setIsLinkProfileModalOpen(true),
      icon: Link,
    },
    {
      id: "export-keys",
      label: "Export Keys",
      onClick: () => setIsExportKeysModalOpen(true),
      icon: Key,
    },
    {
      id: "sign-out",
      label: "Sign Out",
      onClick: signOut,
      icon: LogOut,
    },
  ]

  // Navigation items - Management group
  const managementNavigationItems = [
    {
      id: "webhooks",
      label: "Webhooks",
      onClick: () => setIsWebhookModalOpen(true),
      icon: Webhook,
    },
    // {
    //   id: "api-keys",
    //   label: "API Keys",
    //   onClick: () => setIsApiKeyModalOpen(true),
    //   icon: Key,
    // },
    {
      id: "support",
      label: "Support",
      onClick: () => {
        window.open("https://t.me/+cZl8RfDl9b4wZDYx", "_blank")
      },
      icon: FileText,
    },
    {
      id: "docs",
      label: "Docs",
      onClick: () => {
        window.open(
          "https://www.notion.so/Dev-Docs-2ccaf3750d6b806b974be214c87c37e1",
          "_blank",
        )
      },
      icon: BookOpen,
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Header with Network Toggle */}
        <div className="flex justify-end mb-6">
          <NetworkToggle />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Left column - Wallet + Navigation */}
          <div className="space-y-4">
            {/* Connected wallet card + profile nav */}
            <div>
              <WalletCard onSendMoney={() => setIsSendMoneyModalOpen(true)} />
              <Navigation
                items={profileNavigationItems}
                variant="light"
                roundedTop={false}
                roundedBottom={true}
              />
            </div>
            <Navigation items={managementNavigationItems} variant="dark" />
          </div>

          {/* Right column - Subscriptions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <SubscriptionList
              subscriptionOwnerAddress={
                account?.subscriptionOwnerAddress ?? undefined
              }
            />
          </div>
        </div>

        {/* Modals */}
        <WebhookModal
          isOpen={isWebhookModalOpen}
          onClose={() => setIsWebhookModalOpen(false)}
        />
        {/* <ApiKeyModal
          isOpen={isApiKeyModalOpen}
          onClose={() => setIsApiKeyModalOpen(false)}
        /> */}
        <LinkProfileModal
          isOpen={isLinkProfileModalOpen}
          onClose={() => setIsLinkProfileModalOpen(false)}
        />
        <SendMoneyModal
          isOpen={isSendMoneyModalOpen}
          onClose={() => setIsSendMoneyModalOpen(false)}
        />
        {evmAddress && (
          <ExportKeysModal
            isOpen={isExportKeysModalOpen}
            onClose={() => setIsExportKeysModalOpen(false)}
            smartAccountAddress={evmAddress}
          />
        )}
      </div>
    </div>
  )
}
