import { useState, useEffect } from "react"
import { base } from "@base-org/account"

interface Account {
  address: string
}

interface SubscriptionInfo {
  id: string
  subscriptionPayer: string
  recurringCharge: string
  periodInDays: number
}

interface SubscriptionStatus {
  isSubscribed: boolean
  remainingChargeInPeriod?: string
  nextPeriodStart?: Date
  subscriptionOwner?: string
  subscriptionPayer?: string
}

interface ErrorInfo {
  title: string
  message: string
  details?: string
  type?: "gas" | "error"
}

export function SubscriptionManager() {
  const [account, setAccount] = useState<Account | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(
    null,
  )
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatus | null>(null)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | ErrorInfo | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showBackendPanel, setShowBackendPanel] = useState(false)
  const showBackendControl = false

  useEffect(() => {
    // Load subscription from localStorage
    const storedSubscription = localStorage.getItem("bbq-subscription")
    if (storedSubscription) {
      try {
        const parsedSubscription = JSON.parse(storedSubscription)
        setSubscription(parsedSubscription)
        handleGetStatus(parsedSubscription.id)
      } catch (err) {
        console.error("Failed to parse stored subscription:", err)
      }
    }
  }, [])

  // Create Subscription
  const handleCreateSubscription = async () => {
    // get CDP Wallet
    const accountAddress = import.meta.env.VITE_COUCH_WALLET_ADDRESS

    if (!accountAddress) {
      throw new Error("SERVER ADDRESS NOT SET")
    }

    setLoading({ ...loading, subscription: true })
    setError(null)
    setSuccess(null)

    try {
      const subscription = await base.subscription.subscribe({
        recurringCharge: "0.0099", // Monthly charge in USDC
        subscriptionOwner: accountAddress, // Our backend wallet address
        periodInDays: 1, // 1-day billing period
        testnet: true, // Use testnet (Base Sepolia)
      })

      console.log("Subscription created:", subscription)

      const subscriptionData = {
        id: subscription.id,
        subscriptionPayer: subscription.subscriptionPayer,
        recurringCharge: subscription.recurringCharge,
        periodInDays: subscription.periodInDays,
      }

      setSubscription(subscriptionData)
      localStorage.setItem("bbq-subscription", JSON.stringify(subscriptionData))

      setSuccess(`Subscription created successfully!`)
      handleChargeSubscription(subscriptionData.id)
      // Auto-check status after creation
      setTimeout(() => handleGetStatus(subscription.id), 2000)
    } catch (err: any) {
      console.error("Subscription failed:", err)
      setError(err.message || "Failed to create subscription")
    } finally {
      setLoading({ ...loading, subscription: false })
    }
  }

  // Get Subscription Status
  const handleGetStatus = async (subscriptionId?: string) => {
    const id = subscriptionId || subscription?.id
    console.log("Id", id)
    if (!id) {
      setError("No subscription created yet")
      return
    }

    setLoading({ ...loading, status: true })
    setError(null)

    try {
      const status = await base.subscription.getStatus({
        id: id,
        testnet: true,
      })

      console.log("Subscription status:", status)
      setSubscriptionStatus(status)
    } catch (err: any) {
      console.error("Failed to get status:", err)
      setError(err.message || "Failed to get subscription status")
    } finally {
      setLoading({ ...loading, status: false })
    }
  }

  // Charge Subscription
  const handleChargeSubscription = async (subscriptionId?: string) => {
    const id = subscriptionId || subscription?.id
    if (!id) {
      setError("Please create a subscription first")
      return
    }

    setLoading({ ...loading, charge: true })
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`http://localhost:3000/api/subscriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscription_id: id,
        }),
      })

      const data = await response.json<{
        subscription_id: string
        is_subscribed: number
        billing_status: string
        recurring_charge: string
        period_days: number
        next_charge_at: string
        last_charge_at: string
        created_at: string
        updated_at: string
        message: string
      }>()
      console.log(data)
      setSuccess(data.message)
      // Refresh status after charge
      setTimeout(async () => {
        await handleGetStatus(data.subscription_id)
      }, 1000)

      // if (!response.ok) {
      //   // Handle structured error responses from the API
      //   if (data.error === "Insufficient Gas") {
      //     setError({
      //       title: data.error,
      //       message: data.message,
      //       details: data.details,
      //       type: "gas",
      //     } as any)
      //   } else if (data.error) {
      //     setError({
      //       title: data.error,
      //       message: data.message || data.error,
      //       details: data.details,
      //       type: "error",
      //     } as any)
      //   } else {
      //     throw new Error(data.error || "Failed to charge subscription")
      //   }
      //   return
      // }

      // if (data.success) {
      //   setSuccess(data.message || `Successfully charged $${data.amount}`)
      //   // Refresh status after charge
      //   setTimeout(() => {
      //     handleGetStatus()
      //   }, 2000)
      // } else {
      //   setError(data.message || "Failed to charge subscription")
      // }
    } catch (err: any) {
      console.error("Charge failed:", err)
      setError(err.message || "Failed to charge subscription")
    } finally {
      setLoading({ ...loading, charge: false })
    }
  }

  return (
    <div className="min-h-screen gradient-bg relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000"></div>
      </div>

      {/* Backend Control Panel - Top Right */}
      {showBackendControl && (
        <div className="absolute top-4 right-4 z-50">
          <button
            onClick={() => setShowBackendPanel(!showBackendPanel)}
            className="glass-dark text-white px-4 py-2 rounded-lg flex items-center space-x-2 hover:bg-gray-800/90 transition-all"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            <span className="text-sm font-medium">Backend Controls</span>
          </button>

          {showBackendPanel && (
            <div className="mt-2 glass-dark text-white p-4 rounded-lg w-80">
              <h3 className="text-sm font-bold mb-3 text-gray-300">
                Backend Operations
              </h3>

              <div className="space-y-2">
                {/* <button
                onClick={handleCreateWallet}
                disabled={loading.wallet || !!wallet}
                className={`w-full py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center space-x-2 ${
                  wallet
                    ? 'bg-green-600/20 text-green-400 cursor-not-allowed'
                    : loading.wallet
                    ? 'bg-gray-600/50 text-gray-300 cursor-wait'
                    : 'bg-blue-600/80 hover:bg-blue-600 text-white'
                }`}
              >
                {loading.wallet ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Creating...</span>
                  </>
                ) : wallet ? (
                  <>
                    <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                      <path d="M5 13l4 4L19 7"></path>
                    </svg>
                    <span>Wallet Created</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                      <path d="M12 4v16m8-8H4"></path>
                    </svg>
                    <span>Create Wallet</span>
                  </>
                )}
              </button> */}

                <button
                  onClick={() => handleChargeSubscription()}
                  disabled={loading.charge || !subscription}
                  className={`w-full py-2 px-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center space-x-2 ${
                    !subscription
                      ? "bg-gray-600/50 text-gray-400 cursor-not-allowed"
                      : loading.charge
                        ? "bg-orange-600/50 text-orange-300 cursor-wait"
                        : "bg-orange-600/80 hover:bg-orange-600 text-white"
                  }`}
                >
                  {loading.charge ? (
                    <>
                      <svg
                        className="animate-spin h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <span>Charging...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                      <span>Charge $1 to Subscription</span>
                    </>
                  )}
                </button>

                {account && (
                  <div className="mt-2 p-2 bg-gray-800/50 rounded text-xs">
                    <p className="text-gray-400 mb-1">Server Wallet:</p>
                    <p className="font-mono text-gray-300 break-all">
                      {account!.address}
                    </p>
                    <p className="text-yellow-400 mt-2 text-[10px] leading-tight">
                      ⚠️ Add Base Sepolia ETH to this wallet for gas fees to
                      execute subscription charges
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-6xl font-bold text-white mb-4 drop-shadow-2xl">
            Premium Subscription
          </h1>
          <p className="text-xl text-white/90 max-w-2xl mx-auto drop-shadow-lg">
            Experience the future of decentralized subscriptions on Base
          </p>
        </div>

        {/* Alert Messages */}
        {(error || success) && (
          <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 animate-slideDown max-w-lg">
            {error && (
              <div
                className={`glass-effect ${
                  typeof error === "object" && error.type === "gas"
                    ? "bg-yellow-500/20 border-yellow-500/50"
                    : "bg-red-500/20 border-red-500/50"
                } text-white px-6 py-4 rounded-lg`}
              >
                {typeof error === "object" ? (
                  <div>
                    <div className="flex items-start space-x-2 mb-2">
                      {error.type === "gas" ? (
                        <svg
                          className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                        </svg>
                      ) : (
                        <svg
                          className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                      )}
                      <div className="flex-1">
                        <p className="font-semibold text-base">{error.title}</p>
                        <p className="text-sm text-white/90 mt-1">
                          {error.message}
                        </p>
                        {error.details && (
                          <p className="text-xs text-white/70 mt-2">
                            {error.details}
                          </p>
                        )}
                        {error.type === "gas" && account && (
                          <div className="mt-3 p-2 bg-black/20 rounded">
                            <p className="text-xs text-white/80 mb-1">
                              Server wallet address:
                            </p>
                            <p className="font-mono text-xs text-white break-all">
                              {account.address}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <span>{error}</span>
                  </div>
                )}
              </div>
            )}

            {success && (
              <div className="glass-effect bg-green-500/20 border-green-500/50 text-white px-6 py-3 rounded-lg flex items-center space-x-2">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>{success}</span>
              </div>
            )}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl w-full">
          {/* Subscription Card */}
          <div className="glass-effect rounded-2xl p-8 shine-effect">
            <div className="relative z-10">
              <div className="mb-6">
                <h2 className="text-3xl font-bold text-white mb-2">Pro Plan</h2>
                <p className="text-white/80">Unlock all premium features</p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline">
                  <span className="text-5xl font-bold text-white">
                    $0.0099{" "}
                  </span>
                  <span className="text-white/70 ml-2">/day</span>
                </div>
                <p className="text-sm text-white/60 mt-2">
                  Billed monthly in USDC
                </p>
              </div>

              <ul className="space-y-4 mb-8">
                <li className="flex items-start text-white">
                  <svg
                    className="w-5 h-5 text-green-400 mt-0.5 mr-3 flex-shrink-0"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span>USDC on Base Only</span>
                </li>
                <li className="flex items-start text-white">
                  <svg
                    className="w-5 h-5 text-green-400 mt-0.5 mr-3 flex-shrink-0"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span>Coinbase takes 0 fees</span>
                </li>
                <li className="flex items-start text-white">
                  <svg
                    className="w-5 h-5 text-green-400 mt-0.5 mr-3 flex-shrink-0"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span>Secure on-chain transactions</span>
                </li>
                <li className="flex items-start text-white">
                  <svg
                    className="w-5 h-5 text-green-400 mt-0.5 mr-3 flex-shrink-0"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                  <span>1 click - No wallet connection required</span>
                </li>
              </ul>

              <button
                onClick={handleCreateSubscription}
                disabled={loading.subscription || !!subscription}
                className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all transform hover:scale-105 flex items-center justify-center space-x-2 ${
                  subscription
                    ? "bg-green-500/80 text-white cursor-not-allowed"
                    : loading.subscription
                      ? "bg-white/50 text-gray-600 cursor-wait"
                      : "bg-white text-purple-600 hover:bg-white/90 pulse-glow"
                }`}
              >
                {loading.subscription ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span>Creating Subscription...</span>
                  </>
                ) : subscription ? (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M5 13l4 4L19 7"></path>
                    </svg>
                    <span>Subscribed</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                    </svg>
                    <span>Subscribe Now</span>
                  </>
                )}
              </button>

              {/* {!account && !subscription && (
                <p className="text-xs text-white/60 text-center mt-3">
                  Create a wallet first using Backend Controls →
                </p>
              )} */}
            </div>
          </div>

          {/* Status Card */}
          <div className="glass-effect rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">
                Subscription Status
              </h2>
              {subscription && (
                <button
                  onClick={() => handleGetStatus()}
                  disabled={loading.status}
                  className="p-2 rounded-lg glass-effect hover:bg-white/20 transition-all"
                >
                  {loading.status ? (
                    <svg
                      className="animate-spin h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                  ) : (
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                  )}
                </button>
              )}
            </div>

            {subscription ? (
              <div className="space-y-4">
                {/* Status Badge */}
                <div className="flex items-center justify-between p-4 bg-white/10 rounded-xl">
                  <div className="flex items-center space-x-3">
                    {subscriptionStatus?.isSubscribed ? (
                      <>
                        <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                        <span className="font-semibold text-green-400">
                          Active Subscription
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse"></div>
                        <span className="font-semibold text-yellow-400">
                          Status Check In Progress
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="bg-white/5 rounded-xl p-4">
                  <p className="text-sm text-white/60 mb-1">Subscription ID</p>
                  <p className="font-mono text-sm text-white/90 break-all">
                    {subscription.id}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-xs text-white/60 mb-1">Monthly Charge</p>
                    <p className="font-semibold text-white">
                      ${subscription.recurringCharge} USDC
                    </p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3">
                    <p className="text-xs text-white/60 mb-1">Billing Period</p>
                    <p className="font-semibold text-white">
                      {subscription.periodInDays} days
                    </p>
                  </div>
                </div>

                {subscriptionStatus && (
                  <>
                    {subscriptionStatus.remainingChargeInPeriod && (
                      <div className="bg-purple-500/20 rounded-xl p-4">
                        <p className="text-sm text-purple-200 mb-1">
                          Remaining in Period
                        </p>
                        <div className="flex items-baseline space-x-2">
                          <p className="text-2xl font-bold text-white">
                            ${subscriptionStatus.remainingChargeInPeriod}
                          </p>
                          <span className="text-sm text-white/60">USDC</span>
                        </div>
                      </div>
                    )}

                    {subscriptionStatus.nextPeriodStart && (
                      <div className="bg-white/5 rounded-xl p-4">
                        <p className="text-sm text-white/60 mb-1">
                          Next Billing Date
                        </p>
                        <p className="font-semibold text-white">
                          {subscriptionStatus.nextPeriodStart instanceof Date
                            ? subscriptionStatus.nextPeriodStart.toLocaleDateString(
                                "en-US",
                                {
                                  weekday: "long",
                                  year: "numeric",
                                  month: "long",
                                  day: "numeric",
                                },
                              )
                            : new Date(
                                subscriptionStatus.nextPeriodStart,
                              ).toLocaleDateString("en-US", {
                                weekday: "long",
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })}
                        </p>
                      </div>
                    )}
                  </>
                )}

                <div className="bg-white/5 rounded-xl p-3">
                  <p className="text-xs text-white/60 mb-1">
                    Subscription Payer
                  </p>
                  <p className="font-mono text-xs text-white/90 break-all">
                    {subscription.subscriptionPayer}
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <svg
                  className="w-20 h-20 text-white/30 mx-auto mb-4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
                </svg>
                <p className="text-white/60 text-lg mb-2">
                  No active subscription
                </p>
                <p className="text-sm text-white/40">
                  Click "Subscribe Now" to get started
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Features Section */}
        <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-5xl w-full">
          <div className="glass-effect rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-white mb-2">
              Secure & Transparent
            </h4>
            <p className="text-white/70 text-sm">
              All transactions secured on Base blockchain
            </p>
          </div>

          <div className="glass-effect rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-white mb-2">
              Recurring payments
            </h4>
            <p className="text-white/70 text-sm">
              Subscribe once, after the user subscribes, they do not need to
              manually approve subsequent payments
            </p>
          </div>

          <div className="glass-effect rounded-xl p-6 text-center">
            <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
            </div>
            <h4 className="text-lg font-semibold text-white mb-2">
              Dev Friendly Setup
            </h4>
            <p className="text-white/70 text-sm">
              Abstracts away complex blockchain interactions
            </p>
          </div>
        </div>
      </div>

      {/* Add custom animations */}
      <style>{`
        @keyframes blob {
          0% {
            transform: translate(0px, 0px) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
          100% {
            transform: translate(0px, 0px) scale(1);
          }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
        .animate-slideDown {
          animation: slideDown 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
