import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@app-client/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app-client/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app-client/components/ui/table"
import { useNetwork } from "@app-client/hooks/useNetwork"
import {
  useCreateSubscription,
  useListSubscriptions,
  useRevokeSubscription,
  useSubscription,
} from "@app-client/hooks/useSubscriptions"
import { formatDate, formatDateTime } from "@app-client/lib/utils"
import { subscribe } from "@base-org/account/browser"
import { MoreVertical } from "lucide-react"
import { useState } from "react"

export function SubscriptionList({
  subscriptionOwnerAddress,
}: {
  subscriptionOwnerAddress?: string
}) {
  const { isTestnet } = useNetwork()
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<
    string | undefined
  >(undefined)

  // Create subscription modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [chargeAmount, setChargeAmount] = useState("")
  const [periodValue, setPeriodValue] = useState("")
  const [periodUnit, setPeriodUnit] = useState<
    "seconds" | "minutes" | "hours" | "days"
  >("days")
  const [isCreatingOnchain, setIsCreatingOnchain] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const {
    data: subscriptions,
    isLoading,
    error,
  } = useListSubscriptions(isTestnet)
  const {
    data: subscriptionDetail,
    isLoading: isLoadingDetail,
    error: detailError,
  } = useSubscription(selectedSubscriptionId)
  const revokeMutation = useRevokeSubscription()
  const createMutation = useCreateSubscription()

  const handleRevoke = async (subscriptionId: string) => {
    if (
      !confirm(
        "Revoke this subscription? This will cancel all future payments immediately.",
      )
    )
      return

    try {
      await revokeMutation.mutateAsync({ subscriptionId })
      setSelectedSubscriptionId(undefined)
    } catch {}
  }

  const convertPeriodToSeconds = (value: number, unit: string): number => {
    const multipliers = {
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
    }
    return value * multipliers[unit as keyof typeof multipliers]
  }

  const handleCreate = async () => {
    if (!chargeAmount || !periodValue || !subscriptionOwnerAddress) {
      return
    }

    setCreateError(null)
    setIsCreatingOnchain(true)

    try {
      // Step 1: Create onchain via Base SDK
      const periodNum = Number.parseFloat(periodValue)
      const periodInSeconds = convertPeriodToSeconds(periodNum, periodUnit)

      const subscription = await subscribe(
        isTestnet
          ? {
              recurringCharge: chargeAmount,
              subscriptionOwner: subscriptionOwnerAddress as `0x${string}`,
              testnet: true,
              // For testnet, always use overridePeriodInSecondsForTestnet
              overridePeriodInSecondsForTestnet: periodInSeconds,
            }
          : {
              recurringCharge: chargeAmount,
              subscriptionOwner: subscriptionOwnerAddress as `0x${string}`,
              testnet: false,
              // For mainnet, use periodInDays
              periodInDays: Math.ceil(periodInSeconds / 86400),
            },
      )

      setIsCreatingOnchain(false)

      if (!subscription?.id) {
        throw new Error("Failed to create subscription onchain")
      }

      // Step 2: Register with backend
      await createMutation.mutateAsync({
        subscriptionId: subscription.id,
        provider: "base",
        testnet: isTestnet,
      })

      // Success - reset and close
      setChargeAmount("")
      setPeriodValue("")
      setPeriodUnit("days")
      setShowCreateModal(false)
    } catch (err) {
      setIsCreatingOnchain(false)
      const errorMessage =
        err instanceof Error ? err.message : "Failed to create subscription"
      setCreateError(errorMessage)
    }
  }

  const formatAmount = (amount: string) => {
    // Convert from USDC base units (6 decimals) to display units
    const value = Number(amount) / 1_000_000
    return `$${value.toFixed(2)}`
  }

  const formatPeriod = (seconds: number) => {
    // Handle seconds and minutes
    if (seconds < 60) {
      return seconds === 1 ? "Every second" : `Every ${seconds} seconds`
    }
    if (seconds < 3600) {
      const minutes = seconds / 60
      return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`
    }

    // Handle hours
    if (seconds < 86400) {
      const hours = seconds / 3600
      return hours === 1 ? "Every hour" : `Every ${hours} hours`
    }

    // Handle days
    const days = seconds / 86400
    if (days === 1) return "Every day"
    if (days === 7) return "Every week"
    if (days === 30 || days === 31) return "Every month"
    if (days === 365 || days === 366) return "Every year"

    // Fallback for custom periods
    if (days < 30) return `Every ${days} days`
    if (days < 365) {
      const weeks = Math.round(days / 7)
      return weeks === 1 ? "Every week" : `Every ${weeks} weeks`
    }
    const years = Math.round(days / 365)
    return years === 1 ? "Every year" : `Every ${years} years`
  }

  const formatSubscriptionId = (id: string) => {
    if (id.length <= 12) return id
    return `${id.slice(0, 8)}...${id.slice(-4)}`
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800"
      case "processing":
        return "bg-blue-100 text-blue-800"
      case "past_due":
        return "bg-yellow-100 text-yellow-800"
      case "incomplete":
        return "bg-orange-100 text-orange-800"
      case "canceled":
        return "bg-gray-100 text-gray-800"
      case "unpaid":
        return "bg-red-100 text-red-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  const getOrderStatusBadgeClass = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-800"
      case "pending":
        return "bg-blue-100 text-blue-800"
      case "processing":
        return "bg-blue-100 text-blue-800"
      case "failed":
        return "bg-red-100 text-red-800"
      case "pending_retry":
        return "bg-yellow-100 text-yellow-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 bg-white rounded shadow">
        <p className="text-gray-600">Loading subscriptions...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 rounded shadow">
        <p className="text-red-600">
          Error loading subscriptions: {error.message}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-700">Subscriptions</h2>
        <div className="flex items-center gap-4">
          {/* Create button */}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            disabled={!subscriptionOwnerAddress}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm cursor-pointer"
          >
            Create Subscription
          </button>
        </div>
      </div>

      {/* Subscription list */}
      {subscriptions && subscriptions.length > 0 ? (
        <div className="border rounded-lg overflow-hidden bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Subscription ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Period</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="text-right w-[60px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((subscription) => (
                <TableRow key={subscription.subscriptionId}>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedSubscriptionId(subscription.subscriptionId)
                      }
                      className="text-gray-700 hover:underline cursor-pointer text-left font-semibold"
                      title={subscription.subscriptionId}
                    >
                      {formatSubscriptionId(subscription.subscriptionId)}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClass(subscription.status)}`}
                    >
                      {subscription.status}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="text-sm text-muted-foreground">
                      {subscription.lastOrder
                        ? formatAmount(subscription.lastOrder.amount)
                        : "-"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="text-sm text-muted-foreground">
                      {subscription.lastOrder
                        ? formatPeriod(
                            subscription.lastOrder.periodLengthInSeconds,
                          )
                        : "-"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm text-muted-foreground">
                      {formatDate(subscription.createdAt)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8 p-0 cursor-pointer text-gray-700"
                          aria-label="Open menu"
                        >
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setSelectedSubscriptionId(
                              subscription.subscriptionId,
                            )
                          }
                        >
                          View
                        </DropdownMenuItem>
                        {(subscription.status === "active" ||
                          subscription.status === "past_due" ||
                          subscription.status === "unpaid") && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              handleRevoke(subscription.subscriptionId)
                            }
                          >
                            Revoke
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="p-8 text-center bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-600">No subscriptions found</p>
          <p className="text-sm text-gray-500 mt-1">
            Subscriptions will appear here once customers create them
          </p>
        </div>
      )}

      {/* Subscription detail drawer */}
      <Sheet
        open={!!selectedSubscriptionId}
        onOpenChange={(open) => {
          if (!open) setSelectedSubscriptionId(undefined)
        }}
      >
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Subscription Details</SheetTitle>
            <SheetDescription>
              View subscription information and order history
            </SheetDescription>
          </SheetHeader>

          {isLoadingDetail && (
            <div className="py-8 text-center">
              <p className="text-gray-600">Loading subscription details...</p>
            </div>
          )}

          {detailError && (
            <div className="py-8">
              <p className="text-red-600">Error: {detailError.message}</p>
            </div>
          )}

          {subscriptionDetail && (
            <div className="mt-6 space-y-6">
              {/* Subscription info */}
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    Subscription ID
                  </div>
                  <code className="block px-3 py-2 bg-gray-50 border border-gray-200 rounded font-mono text-sm break-all">
                    {subscriptionDetail.subscription.subscriptionId}
                  </code>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">
                      Status
                    </div>
                    <span
                      className={`inline-block px-3 py-1 rounded text-sm font-medium ${getStatusBadgeClass(subscriptionDetail.subscription.status)}`}
                    >
                      {subscriptionDetail.subscription.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-1">
                      Network
                    </div>
                    <span className="text-sm text-gray-900">
                      {subscriptionDetail.subscription.testnet
                        ? "Testnet"
                        : "Mainnet"}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-sm font-medium text-gray-700 mb-1">
                    Beneficiary Address
                  </div>
                  <code className="block px-3 py-2 bg-gray-50 border border-gray-200 rounded font-mono text-sm break-all">
                    {subscriptionDetail.subscription.beneficiaryAddress}
                  </code>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Created:</span>{" "}
                    {formatDateTime(subscriptionDetail.subscription.createdAt)}
                  </div>
                  <div>
                    <span className="text-gray-600">Modified:</span>{" "}
                    {formatDateTime(subscriptionDetail.subscription.modifiedAt)}
                  </div>
                </div>
              </div>

              {/* Revoke button */}
              {(subscriptionDetail.subscription.status === "active" ||
                subscriptionDetail.subscription.status === "past_due" ||
                subscriptionDetail.subscription.status === "unpaid") && (
                <div className="pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() =>
                      handleRevoke(
                        subscriptionDetail.subscription.subscriptionId,
                      )
                    }
                    disabled={revokeMutation.isPending}
                    className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {revokeMutation.isPending
                      ? "Revoking..."
                      : "Revoke Subscription"}
                  </button>
                  {revokeMutation.isError && (
                    <p className="text-sm text-red-600 mt-2">
                      {revokeMutation.error.message}
                    </p>
                  )}
                </div>
              )}

              {/* Order history */}
              <div className="pt-4 border-t border-gray-200">
                <h4 className="text-base font-semibold mb-3">Order History</h4>
                {subscriptionDetail.orders.length === 0 ? (
                  <p className="text-sm text-gray-600">No orders yet</p>
                ) : (
                  <div className="space-y-3">
                    {subscriptionDetail.orders.map((order) => (
                      <div
                        key={order.orderNumber}
                        className="p-3 bg-gray-50 border border-gray-200 rounded"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                Order #{order.orderNumber}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-medium ${getOrderStatusBadgeClass(order.status)}`}
                              >
                                {order.status}
                              </span>
                              <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs">
                                {order.type}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mt-1">
                              {formatAmount(order.amount)} •{" "}
                              {formatPeriod(order.periodLengthInSeconds)}
                            </p>
                          </div>
                          <div className="text-right text-sm text-gray-600">
                            <p>Due: {formatDateTime(order.dueAt)}</p>
                            {order.attempts > 0 && (
                              <p className="text-xs">
                                Attempts: {order.attempts}
                              </p>
                            )}
                          </div>
                        </div>

                        {order.transactionHash && (
                          <div className="mt-2">
                            <div className="text-xs text-gray-600 mb-1">
                              Transaction Hash
                            </div>
                            <code className="block px-2 py-1 bg-white border border-gray-300 rounded font-mono text-xs break-all">
                              {order.transactionHash}
                            </code>
                          </div>
                        )}

                        {order.failureReason && (
                          <div className="mt-2">
                            <p className="text-xs text-red-600">
                              Failure: {order.failureReason}
                            </p>
                          </div>
                        )}

                        <p className="text-xs text-gray-500 mt-2">
                          Created {formatDateTime(order.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Subscription Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setShowCreateModal(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowCreateModal(false)
            }
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="document"
          >
            <h3 className="text-lg font-semibold mb-4">Create Subscription</h3>

            {/* Charge Amount */}
            <div className="mb-4">
              <label
                htmlFor="charge-amount"
                className="block text-sm font-medium mb-2"
              >
                Charge Amount (USDC)
              </label>
              <input
                id="charge-amount"
                type="text"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="0.01"
                className="w-full px-3 py-2 border rounded"
              />
            </div>

            {/* Period */}
            <div className="mb-4">
              <label
                htmlFor="period-value"
                className="block text-sm font-medium mb-2"
              >
                Period
              </label>
              <div className="flex gap-2">
                <input
                  id="period-value"
                  type="number"
                  value={periodValue}
                  onChange={(e) => setPeriodValue(e.target.value)}
                  placeholder="30"
                  min="1"
                  step="any"
                  className="flex-1 px-3 py-2 border rounded"
                />
                <select
                  value={periodUnit}
                  onChange={(e) =>
                    setPeriodUnit(
                      e.target.value as
                        | "seconds"
                        | "minutes"
                        | "hours"
                        | "days",
                    )
                  }
                  className="px-3 py-2 border rounded bg-white"
                >
                  {isTestnet ? (
                    <>
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </>
                  ) : (
                    <option value="days">Days</option>
                  )}
                </select>
              </div>
            </div>

            {/* Network Info */}
            <div className="mb-4 p-3 bg-gray-100 rounded">
              <div className="text-sm">
                <span className="font-medium">Network:</span>{" "}
                {isTestnet ? "Testnet" : "Mainnet"}
              </div>
            </div>

            {/* Error Display */}
            {createError && (
              <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
                {createError}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCreate}
                disabled={
                  isCreatingOnchain ||
                  createMutation.isPending ||
                  !chargeAmount ||
                  !periodValue
                }
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingOnchain
                  ? "Creating onchain..."
                  : createMutation.isPending
                    ? "Registering..."
                    : "Create"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false)
                  setChargeAmount("")
                  setPeriodValue("")
                  setPeriodUnit("days")
                  setCreateError(null)
                }}
                disabled={isCreatingOnchain || createMutation.isPending}
                className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
