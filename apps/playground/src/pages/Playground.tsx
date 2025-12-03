import { useEffect, useState } from "react"

import { NetworkSelector } from "@/components/NetworkSelector"
import { SubscriptionCreator } from "@/components/SubscriptionCreator"
import { SubscriptionDetails } from "@/components/SubscriptionDetails"
import { SubscriptionsList } from "@/components/SubscriptionsList"
import { useNetwork } from "@/store/NetworkContext"

export const Playground = () => {
  const { network } = useNetwork()
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<
    string | null
  >(null)

  // Deselect subscription when network changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to run this effect when network changes
  useEffect(() => {
    setSelectedSubscriptionId(null)
  }, [network])

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Couch Playground</h1>
            <p className="text-muted-foreground mt-2">
              Subscription testing tool
            </p>
          </div>
          <NetworkSelector />
        </div>

        <div className="grid gap-6 lg:grid-cols-[450px_1fr]">
          {/* Left column - Create subscription + List */}
          <div className="flex flex-col gap-6">
            <SubscriptionCreator />
            <SubscriptionsList
              selectedId={selectedSubscriptionId}
              onSelect={setSelectedSubscriptionId}
            />
          </div>

          {/* Right column - Subscription Details */}
          <div>
            <SubscriptionDetails subscriptionId={selectedSubscriptionId} />
          </div>
        </div>
      </div>
    </div>
  )
}
