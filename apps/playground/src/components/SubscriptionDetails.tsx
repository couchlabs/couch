import { createBaseAccountSDK } from "@base-org/account"
import { getSubscriptionStatus } from "@base-org/account/payment"
import {
  fetchPermission,
  requestRevoke,
} from "@base-org/account/spend-permission"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  HelpCircle,
  Loader2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getSubscription, getSubscriptionEvents } from "@/lib/api"
import { formatPeriod } from "@/lib/formatPeriod"
import type {
  Subscription,
  WebhookEvent,
  WebhookEventData,
} from "@/types/subscription"

interface SubscriptionDetailsProps {
  subscriptionId: string | null
}

export function SubscriptionDetails({
  subscriptionId,
}: SubscriptionDetailsProps) {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [events, setEvents] = useState<WebhookEvent[]>([])
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [onchainExpanded, setOnchainExpanded] = useState(false)
  const [onchainStatus, setOnchainStatus] = useState<{
    isSubscribed: boolean
    subscriptionOwner?: string
    owner?: string
    spender?: string
    remainingChargeInPeriod?: string
    nextPeriodStart?: number
    recurringCharge?: string
  } | null>(null)
  const [onchainLoading, setOnchainLoading] = useState(false)
  const [revokeLoading, setRevokeLoading] = useState(false)
  const [copiedEventId, setCopiedEventId] = useState<number | null>(null)

  useEffect(() => {
    if (!subscriptionId) {
      setSubscription(null)
      setEvents([])
      setOnchainExpanded(false)
      setOnchainStatus(null)
      return
    }

    // Reset state when switching subscriptions
    setOnchainExpanded(false)
    setOnchainStatus(null)

    const fetchDetails = async () => {
      setLoading(true)
      try {
        const [subData, eventsData] = await Promise.all([
          getSubscription(subscriptionId),
          getSubscriptionEvents(subscriptionId),
        ])
        setSubscription(subData)
        setEvents(eventsData)
      } catch (error) {
        console.error("Failed to fetch subscription details:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchDetails()

    // Poll for updates every 2 seconds (compromise between 1s and 3s)
    const interval = setInterval(fetchDetails, 2000)
    return () => clearInterval(interval)
  }, [subscriptionId])

  const toggleEventExpanded = (eventId: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  const fetchOnchainStatus = useCallback(async () => {
    if (!subscriptionId) return

    setOnchainLoading(true)
    try {
      const status = await getSubscriptionStatus({
        id: subscriptionId,
        testnet: true,
      })
      setOnchainStatus({
        ...status,
        nextPeriodStart: status.nextPeriodStart
          ? new Date(status.nextPeriodStart).getTime()
          : undefined,
      })
    } catch (error) {
      console.error("Failed to fetch onchain status:", error)
      setOnchainStatus(null)
    } finally {
      setOnchainLoading(false)
    }
  }, [subscriptionId])

  useEffect(() => {
    if (onchainExpanded && !onchainStatus) {
      fetchOnchainStatus()
    }
  }, [onchainExpanded, onchainStatus, fetchOnchainStatus])

  const handleRevoke = useCallback(async () => {
    if (!subscriptionId) return

    setRevokeLoading(true)
    try {
      // Fetch the permission using subscription ID as permissionHash
      const permission = await fetchPermission({
        permissionHash: subscriptionId,
      })

      if (!permission) {
        throw new Error("Spend permission not found for this subscription")
      }

      // Create SDK instance and get provider
      const sdk = createBaseAccountSDK({ appName: "Couch Playground" })
      const provider = sdk.getProvider()

      // Call requestRevoke with permission and provider
      await requestRevoke({
        permission,
        provider,
      })

      // Optimistically update state - revoke was successful
      setOnchainStatus({
        ...onchainStatus,
        isSubscribed: false,
      })

      // Refresh in background after a delay to confirm
      setTimeout(() => {
        fetchOnchainStatus()
      }, 3000)
    } catch (error) {
      console.error("Failed to revoke permission:", error)
      alert(
        `Failed to revoke permission: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    } finally {
      setRevokeLoading(false)
    }
  }, [subscriptionId, fetchOnchainStatus, onchainStatus])

  const handleCopyPayload = useCallback(
    async (eventId: number, payload: string) => {
      try {
        await navigator.clipboard.writeText(payload)
        setCopiedEventId(eventId)
        setTimeout(() => setCopiedEventId(null), 2000)
      } catch (error) {
        console.error("Failed to copy to clipboard:", error)
      }
    },
    [],
  )

  const _getStatusIcon = (status: Subscription["status"]) => {
    switch (status) {
      case "active":
        return <Check className="h-4 w-4 text-green-600" />
      case "processing":
        return <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
      case "incomplete":
        return <X className="h-4 w-4 text-red-600" />
      case "past_due":
        return <X className="h-4 w-4 text-orange-600" />
      case "unpaid":
        return <X className="h-4 w-4 text-red-600" />
      case "canceled":
        return <X className="h-4 w-4 text-gray-600" />
      default:
        return null
    }
  }

  const formatEventSummary = (event: WebhookEvent): string => {
    try {
      const data: WebhookEventData = JSON.parse(event.event_data)

      if (data.data.order) {
        const order = data.data.order

        // Initial payment (activation charge)
        if (order.type === "initial") {
          return "Subscription activation"
        }

        // Recurring payments
        return "Subscription renewal"
      }

      if (data.data.error) {
        if (data.data.subscription.status === "incomplete") {
          return "Subscription activation"
        }
        if (data.data.subscription.status === "unpaid") {
          return "Subscription renewal"
        }
        return "Error"
      }

      // Processing state (subscription created but not yet charged)
      if (data.data.subscription.status === "processing") {
        return "Subscription creation"
      }

      return `Status: ${data.data.subscription.status}`
    } catch {
      return "Event received"
    }
  }

  const formatTimestamp = (timestamp: string): string => {
    // SQLite datetime() returns UTC format like "2025-10-03 02:38:37"
    // Append 'Z' to explicitly parse as UTC
    const date = new Date(timestamp.includes("Z") ? timestamp : `${timestamp}Z`)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return `${seconds}s ago`
  }

  if (!subscriptionId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription Details</CardTitle>
          <CardDescription>
            Select a subscription to view details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <p>No subscription selected</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (loading && !subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription Details</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-base">
          {subscriptionId && subscriptionId.length >= 12
            ? `${subscriptionId.slice(0, 8)}...${subscriptionId.slice(-4)}`
            : subscriptionId}
        </CardTitle>
        <CardDescription>Subscription details and events</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Section */}
        <div>
          <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            Status
          </h3>
          <div className="border border-primary rounded-md overflow-hidden">
            <div className="p-4 space-y-2 bg-primary text-primary-foreground">
              <p className="text-sm flex items-center gap-2">
                <span className="font-medium">Is Active:</span>
                {subscription?.status === "active" ? (
                  <>
                    <Check className="h-4 w-4 text-primary-foreground" />
                    <span className="opacity-90">Yes</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-primary-foreground" />
                    <span className="opacity-90">No</span>
                  </>
                )}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3.5 w-3.5 opacity-70 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">
                        Indicates whether the subscription charge was
                        successfully executed for the current period. If the
                        onchain permission is revoked by the user, the
                        subscription will become canceled at the next period
                        when it attempts to charge.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </p>
              {subscription?.amount && (
                <p className="text-sm">
                  <span className="font-medium">Amount:</span>{" "}
                  <span className="text-xs opacity-90">
                    {subscription.amount} USDC
                  </span>
                </p>
              )}
              {subscription?.period_in_seconds && (
                <p className="text-sm">
                  <span className="font-medium">Renewal:</span>{" "}
                  <span className="text-xs opacity-90">
                    Every {formatPeriod(subscription.period_in_seconds)}
                  </span>
                </p>
              )}
              {subscriptionId && (
                <p className="text-sm">
                  <span className="font-medium">ID:</span>{" "}
                  <span className="text-xs font-mono opacity-90 break-all">
                    {subscriptionId}
                  </span>
                </p>
              )}
              {subscription?.transaction_hash && (
                <p className="text-sm">
                  <span className="font-medium">Initial Transaction:</span>{" "}
                  <a
                    href={`https://sepolia.basescan.org/tx/${subscription.transaction_hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono opacity-90 hover:underline cursor-pointer break-all"
                  >
                    {subscription.transaction_hash}
                  </a>
                </p>
              )}
            </div>

            {/* Onchain Status */}
            <button
              type="button"
              onClick={() => setOnchainExpanded(!onchainExpanded)}
              className={`w-full text-left p-3 border-t hover:bg-accent transition-colors flex items-center justify-between cursor-pointer ${
                onchainExpanded ? "bg-accent" : ""
              }`}
            >
              <span className="text-sm font-semibold">Onchain data</span>
              <div className="flex items-center gap-2">
                {onchainExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
            </button>
            {onchainExpanded && (
              <div className="border-t bg-muted/50 p-4 space-y-3">
                {onchainLoading && !onchainStatus ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : onchainStatus ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm flex items-center gap-2">
                        <span className="font-medium">Is Subscribed:</span>
                        {onchainStatus.isSubscribed ? (
                          <>
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-muted-foreground">Yes</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">
                                Indicates if the subscription permission is
                                currently active on-chain. Returns{" "}
                                <span className="font-semibold">No</span> if the
                                user has revoked the permission or it has
                                expired.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Owner:</span>{" "}
                        <span className="text-xs font-mono text-muted-foreground">
                          {onchainStatus.subscriptionOwner ||
                            onchainStatus.owner}
                        </span>
                      </p>
                      {onchainStatus.spender && (
                        <p className="text-sm">
                          <span className="font-medium">Spender:</span>{" "}
                          <span className="text-xs font-mono text-muted-foreground">
                            {onchainStatus.spender}
                          </span>
                        </p>
                      )}
                      <p className="text-sm">
                        <span className="font-medium">
                          Remaining Charge in Period:
                        </span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {onchainStatus.remainingChargeInPeriod} USDC
                        </span>
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Next Period Start:</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {(() => {
                            const timestamp = Number(
                              onchainStatus.nextPeriodStart,
                            )
                            return new Date(timestamp).toLocaleString()
                          })()}
                        </span>
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Recurring Charge:</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {onchainStatus.recurringCharge} USDC
                        </span>
                      </p>
                    </div>
                    {/* Action Bar */}
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={(e) => {
                            e.stopPropagation()
                            fetchOnchainStatus()
                          }}
                          disabled={onchainLoading}
                          variant="outline"
                          size="sm"
                          className="h-8"
                        >
                          Refresh
                        </Button>
                        {onchainStatus.isSubscribed && (
                          <Button
                            onClick={handleRevoke}
                            disabled={revokeLoading}
                            variant="destructive"
                            size="sm"
                            className="h-8"
                          >
                            {revokeLoading ? "Revoking..." : "Revoke"}
                          </Button>
                        )}
                      </div>
                      {onchainLoading && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Failed to load onchain status
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Webhook Events */}
        <div>
          <h3 className="text-sm font-semibold mb-3 uppercase tracking-wide text-muted-foreground">
            Webhook Events
          </h3>
          {events.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground border rounded-md">
              No events yet
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              {events.map((event, index) => {
                const isExpanded = expandedEvents.has(event.id)
                return (
                  <div key={event.id} className={index > 0 ? "border-t" : ""}>
                    <button
                      type="button"
                      onClick={() => toggleEventExpanded(event.id)}
                      className={`w-full text-left p-3 hover:bg-accent transition-colors flex items-center gap-3 cursor-pointer ${
                        isExpanded ? "bg-accent" : ""
                      }`}
                    >
                      <div>
                        {(() => {
                          try {
                            const data: WebhookEventData = JSON.parse(
                              event.event_data,
                            )
                            if (data.data.order?.status === "paid") {
                              return (
                                <Check className="h-4 w-4 text-green-600" />
                              )
                            } else if (
                              data.data.order?.status === "failed" ||
                              data.data.error
                            ) {
                              return <X className="h-4 w-4 text-red-600" />
                            } else if (
                              data.data.subscription.status === "processing"
                            ) {
                              return (
                                <Circle className="h-4 w-4 text-yellow-600" />
                              )
                            }
                          } catch {
                            return null
                          }
                          return null
                        })()}
                      </div>
                      <div className="flex-1 flex items-center justify-between gap-2">
                        <p className="text-sm">{formatEventSummary(event)}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatTimestamp(event.created_at)}
                          </p>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t bg-muted/50 p-3">
                        {(() => {
                          try {
                            const data: WebhookEventData = JSON.parse(
                              event.event_data,
                            )
                            const txHash = data.data.transaction?.hash

                            return (
                              <div className="space-y-3">
                                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                  {JSON.stringify(data, null, 2)}
                                </pre>
                                {/* Action Bar */}
                                <div className="flex items-center gap-2 pt-2 border-t">
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleCopyPayload(
                                        event.id,
                                        event.event_data,
                                      )
                                    }}
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                  >
                                    {copiedEventId === event.id ? (
                                      <>
                                        <Check className="h-3.5 w-3.5 mr-1.5" />
                                        Copied
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                                        Copy
                                      </>
                                    )}
                                  </Button>
                                  {txHash && (
                                    <Button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        window.open(
                                          `https://sepolia.basescan.org/tx/${txHash}`,
                                          "_blank",
                                        )
                                      }}
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                    >
                                      View on BaseScan
                                      <ExternalLink className="h-3 w-3 ml-1.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          } catch {
                            return (
                              <div className="space-y-3">
                                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                                  {event.event_data}
                                </pre>
                                {/* Action Bar */}
                                <div className="flex items-center gap-2 pt-2 border-t">
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleCopyPayload(
                                        event.id,
                                        event.event_data,
                                      )
                                    }}
                                    variant="outline"
                                    size="sm"
                                    className="h-8"
                                  >
                                    {copiedEventId === event.id ? (
                                      <>
                                        <Check className="h-3.5 w-3.5 mr-1.5" />
                                        Copied
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3.5 w-3.5 mr-1.5" />
                                        Copy
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                            )
                          }
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
