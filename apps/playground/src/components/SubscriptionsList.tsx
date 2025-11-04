import { Check, Circle, Loader2, X } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useWebSocket } from "@/hooks/useWebSocket"
import { getSubscriptions } from "@/lib/api"
import { formatSubscriptionSummary } from "@/lib/formatPeriod"
import type { Subscription } from "@/types/subscription"

interface SubscriptionsListProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function SubscriptionsList({
  selectedId,
  onSelect,
}: SubscriptionsListProps) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const { lastMessage } = useWebSocket()

  // Initial fetch on mount
  useEffect(() => {
    const fetchSubscriptions = async () => {
      try {
        const data = await getSubscriptions()
        setSubscriptions(data)
      } catch (error) {
        console.error("Failed to fetch subscriptions:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchSubscriptions()
  }, [])

  // Handle real-time updates from WebSocket
  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === "subscription_update" && lastMessage.data) {
      const updatedSub = lastMessage.data as Subscription

      setSubscriptions((prev) => {
        // Check if subscription exists
        const exists = prev.some((s) => s.id === updatedSub.id)

        if (exists) {
          // Update existing subscription
          return prev.map((s) => (s.id === updatedSub.id ? updatedSub : s))
        } else {
          // Add new subscription at the beginning (newest first)
          return [updatedSub, ...prev]
        }
      })
    }
  }, [lastMessage])

  const getStatusIcon = (
    status: Subscription["status"],
    isSelected: boolean,
  ) => {
    if (isSelected) {
      switch (status) {
        case "active":
          return <Check className="h-4 w-4 text-primary-foreground" />
        case "processing":
          return (
            <Loader2 className="h-4 w-4 text-primary-foreground animate-spin" />
          )
        case "incomplete":
        case "unpaid":
          return <X className="h-4 w-4 text-primary-foreground" />
        case "past_due":
          return <X className="h-4 w-4 text-primary-foreground" />
        case "canceled":
          return <X className="h-4 w-4 text-primary-foreground" />
        default:
          return <Circle className="h-4 w-4 text-primary-foreground/60" />
      }
    }

    switch (status) {
      case "active":
        return <Check className="h-4 w-4 text-green-600" />
      case "processing":
        return <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
      case "incomplete":
        return <X className="h-4 w-4 text-destructive" />
      case "past_due":
        return <X className="h-4 w-4 text-orange-600" />
      case "unpaid":
        return <X className="h-4 w-4 text-destructive" />
      case "canceled":
        return <X className="h-4 w-4 text-gray-600" />
      default:
        return <Circle className="h-4 w-4 text-gray-400" />
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscriptions</CardTitle>
        <CardDescription>Click a subscription to view details</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              No subscriptions yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Create your first subscription above to get started.
            </p>
          </div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            {subscriptions.map((subscription, index) => {
              if (!subscription?.id) return null
              return (
                <button
                  type="button"
                  key={subscription.id}
                  onClick={() => onSelect(subscription.id)}
                  className={`
                    w-full text-left p-3 transition-colors cursor-pointer
                    ${index > 0 ? "border-t" : ""}
                    ${
                      selectedId === subscription.id
                        ? "bg-primary text-primary-foreground"
                        : "bg-card hover:bg-accent"
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getStatusIcon(
                        subscription.status,
                        selectedId === subscription.id,
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-semibold truncate">
                        {subscription.id.slice(0, 8)}...
                        {subscription.id.slice(-4)}
                      </p>
                      {subscription.amount && subscription.period_in_seconds ? (
                        <p
                          className={`text-xs mt-1 ${selectedId === subscription.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                        >
                          {formatSubscriptionSummary(
                            subscription.amount,
                            subscription.period_in_seconds,
                          )}
                        </p>
                      ) : (
                        <p
                          className={`text-xs mt-1 ${selectedId === subscription.id ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                        >
                          Status: {subscription.status}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
