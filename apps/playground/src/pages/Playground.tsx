import { useState } from "react"

import { SubscriptionCreator } from "@/components/SubscriptionCreator"
import { SubscriptionDetails } from "@/components/SubscriptionDetails"
import { SubscriptionsList } from "@/components/SubscriptionsList"

export const Playground = () => {
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<
    string | null
  >(null)

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">Couch Playground</h1>
          <p className="text-muted-foreground mt-2">
            Subscription testing tool
          </p>
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
