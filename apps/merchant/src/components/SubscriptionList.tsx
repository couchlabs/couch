import { useState } from "react"
import {
  useListSubscriptions,
  useRevokeSubscription,
  useSubscription,
} from "@/hooks/useSubscriptions"

export function SubscriptionList() {
  const [testnet, setTestnet] = useState(false)
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<
    string | undefined
  >(undefined)

  const {
    data: subscriptions,
    isLoading,
    error,
  } = useListSubscriptions(testnet)
  const {
    data: subscriptionDetail,
    isLoading: isLoadingDetail,
    error: detailError,
  } = useSubscription(selectedSubscriptionId)
  const revokeMutation = useRevokeSubscription()

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
    } catch (err) {
      console.error("Failed to revoke subscription:", err)
    }
  }

  const formatAmount = (amount: string) => {
    // Convert from USDC base units (6 decimals) to display units
    const value = Number(amount) / 1_000_000
    return `$${value.toFixed(2)}`
  }

  const formatPeriod = (seconds: number) => {
    const days = seconds / 86400
    if (days === 30 || days === 31) return "Monthly"
    if (days === 7) return "Weekly"
    if (days === 1) return "Daily"
    if (days === 365 || days === 366) return "Yearly"
    return `Every ${days} days`
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Subscriptions</h2>
        {/* Network toggle */}
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded">
          <button
            type="button"
            onClick={() => setTestnet(false)}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              !testnet
                ? "bg-white shadow text-gray-900"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Mainnet
          </button>
          <button
            type="button"
            onClick={() => setTestnet(true)}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              testnet
                ? "bg-white shadow text-gray-900"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Testnet
          </button>
        </div>
      </div>

      {/* Subscription list */}
      {subscriptions && subscriptions.length > 0 ? (
        <div className="space-y-2">
          {subscriptions.map((subscription) => (
            <button
              key={subscription.subscriptionId}
              type="button"
              className="w-full p-4 bg-white border border-gray-200 rounded hover:shadow-md transition-shadow text-left"
              onClick={() =>
                setSelectedSubscriptionId(subscription.subscriptionId)
              }
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono text-gray-700">
                      {subscription.subscriptionId.slice(0, 10)}...
                      {subscription.subscriptionId.slice(-8)}
                    </code>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusBadgeClass(subscription.status)}`}
                    >
                      {subscription.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    Beneficiary: {subscription.beneficiaryAddress.slice(0, 6)}
                    ...
                    {subscription.beneficiaryAddress.slice(-4)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Created{" "}
                    {new Date(subscription.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedSubscriptionId(subscription.subscriptionId)
                  }}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm"
                >
                  View Details
                </button>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="p-8 text-center bg-gray-50 rounded border border-gray-200">
          <p className="text-gray-600">No subscriptions found</p>
          <p className="text-sm text-gray-500 mt-1">
            Subscriptions will appear here once customers create them
          </p>
        </div>
      )}

      {/* Subscription detail modal */}
      {selectedSubscriptionId && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedSubscriptionId(undefined)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSelectedSubscriptionId(undefined)
            }
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Subscription Details</h3>
              <button
                type="button"
                onClick={() => setSelectedSubscriptionId(undefined)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ✕
              </button>
            </div>

            {isLoadingDetail && (
              <div className="p-8 text-center">
                <p className="text-gray-600">Loading subscription details...</p>
              </div>
            )}

            {detailError && (
              <div className="p-8">
                <p className="text-red-600">Error: {detailError.message}</p>
              </div>
            )}

            {subscriptionDetail && (
              <div className="p-6 space-y-6">
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
                      {new Date(
                        subscriptionDetail.subscription.createdAt,
                      ).toLocaleString()}
                    </div>
                    <div>
                      <span className="text-gray-600">Modified:</span>{" "}
                      {new Date(
                        subscriptionDetail.subscription.modifiedAt,
                      ).toLocaleString()}
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
                  <h4 className="text-base font-semibold mb-3">
                    Order History
                  </h4>
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
                              <p>
                                Due:{" "}
                                {new Date(order.dueAt).toLocaleDateString()}
                              </p>
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
                            Created {new Date(order.createdAt).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
