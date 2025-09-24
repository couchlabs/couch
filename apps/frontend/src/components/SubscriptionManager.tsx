import { useState, useEffect } from "react"
import { base, createBaseAccountSDK } from "@base-org/account"
import {
  fetchPermission,
  requestRevoke,
} from "@base-org/account/spend-permission"
import { createPublicClient, http } from "viem"
import { baseSepolia } from "viem/chains"

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
  transactionHash?: string // Add optional transaction hash
}

interface ErrorInfo {
  title: string
  message: string
  details?: string
  type?: "gas" | "error"
}

export function SubscriptionManager() {
  const [account, setAccount] = useState<Account | null>(null)
  const [subscriptions, setSubscriptions] = useState<
    Record<string, SubscriptionInfo>
  >({})
  const [subscriptionStatuses, setSubscriptionStatuses] = useState<
    Record<string, SubscriptionStatus>
  >({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | ErrorInfo | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showBackendPanel, setShowBackendPanel] = useState(false)
  const showBackendControl = false

  useEffect(() => {
    // Load subscriptions from localStorage
    const storedSubscriptions = localStorage.getItem("bbq-subscriptions")
    if (storedSubscriptions) {
      try {
        const parsedSubscriptions = JSON.parse(storedSubscriptions)
        setSubscriptions(parsedSubscriptions)
        // Load status for current plan if it exists
        const currentPlanSubscription = parsedSubscriptions[selectedPlan]
        if (currentPlanSubscription) {
          handleGetStatus(currentPlanSubscription.id, selectedPlan)
        }
      } catch (err) {
        console.error("Failed to parse stored subscriptions:", err)
      }
    }
  }, [])

  const [selectedPlan, setSelectedPlan] = useState<"test" | "pro">("test")

  // Get current subscription and status based on selected plan
  const subscription = subscriptions[selectedPlan] || null
  const subscriptionStatus = subscriptionStatuses[selectedPlan] || null
  const PLANS = {
    test: {
      name: "Plan 1",
      description: "Perfect for testing happy path",
      price: "0.0009",
      displayPrice: "$0.0009",
    },
    pro: {
      name: "Plan 2",
      description: "Perfect for testing failing payments",
      price: "100",
      displayPrice: "$100",
    },
  }

  // Create Subscription
  const handleCreateSubscription = async () => {
    // get CDP Wallet
    const accountAddress = import.meta.env.VITE_COUCH_WALLET_ADDRESS

    if (!accountAddress) {
      throw new Error("SERVER ADDRESS NOT SET")
    }

    setError(null)
    setSuccess(null)

    // Clear any existing status for this plan to avoid showing stale data
    setSubscriptionStatuses((prev) => {
      const updated = { ...prev }
      delete updated[selectedPlan]
      return updated
    })

    try {
      const subscription = await base.subscription.subscribe({
        recurringCharge: PLANS[selectedPlan].price, // Selected plan price in USDC
        subscriptionOwner: accountAddress, // Our backend wallet address
        periodInDays: 1, // 1-day billing period
        testnet: true, // Use testnet (Base Sepolia)
      })

      // Set loading only after wallet approval is given
      setLoading({ ...loading, subscription: true })
      console.log("Subscription created:", subscription)

      const subscriptionData = {
        id: subscription.id,
        subscriptionPayer: subscription.subscriptionPayer,
        recurringCharge: subscription.recurringCharge,
        periodInDays: subscription.periodInDays,
      }

      // Store subscription for the current plan
      const updatedSubscriptions = {
        ...subscriptions,
        [selectedPlan]: subscriptionData,
      }
      setSubscriptions(updatedSubscriptions)
      localStorage.setItem(
        "bbq-subscriptions",
        JSON.stringify(updatedSubscriptions),
      )

      setSuccess(`Subscription created successfully!`)
      // Don't check status here - let handleChargeSubscription do it after activation
      // Don't clear loading state here - let handleChargeSubscription manage it
      await handleChargeSubscription(subscriptionData.id)
    } catch (err: any) {
      console.error("Subscription failed:", err)
      setError(err.message || "Failed to create subscription")
      setLoading({ ...loading, subscription: false })
    }
  }

  // Get Subscription Status
  const handleGetStatus = async (
    subscriptionId?: string,
    planType?: "test" | "pro",
  ) => {
    console.log("hey")
    const plan = planType || selectedPlan
    const id = subscriptionId || subscriptions[plan]?.id
    console.log("Id", id, "for plan:", plan)
    if (!id) {
      setError(`No ${plan} subscription created yet`)
      return
    }

    setLoading({ ...loading, status: true })
    // Don't clear error here - we want to keep showing subscription errors

    try {
      // First check if permission exists and get raw data
      const permission = await fetchPermission({ permissionHash: id })
      console.log("Raw permission data:", permission)

      // Check the critical extraData field
      console.log("🔍 Permission details:")
      console.log("  - extraData value:", permission?.permission?.extraData)
      console.log(
        "  - extraData type:",
        typeof permission?.permission?.extraData,
      )
      console.log(
        "  - extraData === undefined?",
        permission?.permission?.extraData === undefined,
      )
      console.log("  - Full permission object:", permission?.permission)

      const status = await base.subscription.getStatus({
        id: id,
        testnet: true,
      })

      console.log("Subscription status:", status)

      // Direct onchain check to prove the SDK bug
      if (permission) {
        const client = createPublicClient({
          chain: baseSepolia,
          transport: http(),
        })

        const spendPermissionManagerAddress =
          "0xf85210B21cC50302F477BA56686d2019dC9b67Ad" as const
        const spendPermissionManagerAbi = [
          {
            inputs: [
              {
                components: [
                  { name: "account", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "token", type: "address" },
                  { name: "allowance", type: "uint160" },
                  { name: "period", type: "uint48" },
                  { name: "start", type: "uint48" },
                  { name: "end", type: "uint48" },
                  { name: "salt", type: "uint256" },
                  { name: "extraData", type: "bytes" },
                ],
                name: "spendPermission",
                type: "tuple",
              },
            ],
            name: "isRevoked",
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "view",
            type: "function",
          },
          {
            inputs: [
              {
                components: [
                  { name: "account", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "token", type: "address" },
                  { name: "allowance", type: "uint160" },
                  { name: "period", type: "uint48" },
                  { name: "start", type: "uint48" },
                  { name: "end", type: "uint48" },
                  { name: "salt", type: "uint256" },
                  { name: "extraData", type: "bytes" },
                ],
                name: "spendPermission",
                type: "tuple",
              },
            ],
            name: "getCurrentPeriod",
            outputs: [
              {
                name: "",
                type: "tuple",
                components: [
                  { name: "start", type: "uint48" },
                  { name: "end", type: "uint48" },
                  { name: "spend", type: "uint160" },
                ],
              },
            ],
            stateMutability: "view",
            type: "function",
          },
        ] as const

        const permissionArgs = {
          account: permission.permission.account as `0x${string}`,
          spender: permission.permission.spender as `0x${string}`,
          token: permission.permission.token as `0x${string}`,
          allowance: BigInt(permission.permission.allowance),
          period: permission.permission.period,
          start: permission.permission.start,
          end: permission.permission.end,
          salt: BigInt(permission.permission.salt),
          extraData: (permission.permission.extraData || "0x") as `0x${string}`,
        }

        const [isRevoked, currentPeriod] = await Promise.all([
          client.readContract({
            address: spendPermissionManagerAddress,
            abi: spendPermissionManagerAbi,
            functionName: "isRevoked",
            args: [permissionArgs],
          }),
          client.readContract({
            address: spendPermissionManagerAddress,
            abi: spendPermissionManagerAbi,
            functionName: "getCurrentPeriod",
            args: [permissionArgs],
          }),
        ])

        console.log("🔍 Direct onchain check:")
        console.log("  - isRevoked:", isRevoked)
        console.log("  - currentPeriod.spend:", currentPeriod.spend.toString())
        console.log("  - SDK says isSubscribed:", status.isSubscribed)

        if (isRevoked && status.isSubscribed) {
          console.error(
            "⚠️ This should not happen with the monkey patch - permission is revoked but SDK still shows subscribed",
          )
        } else if (isRevoked && !status.isSubscribed) {
          console.log(
            "✅ Monkey patch working! Permission is revoked and SDK correctly shows not subscribed",
          )
        }
      }

      // Preserve the transaction hash if it exists
      setSubscriptionStatuses((prev) => ({
        ...prev,
        [plan]: {
          ...status,
          transactionHash: prev[plan]?.transactionHash, // Keep the tx hash
        },
      }))
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
    // Clear the subscription status completely to avoid showing any stale data
    // This ensures we only show status after getting fresh data from server
    setSubscriptionStatuses((prev) => {
      const updated = { ...prev }
      delete updated[selectedPlan]
      return updated
    })
    // Don't clear error/success here since this is called automatically after subscription creation
    // Only clear if user manually clicks charge button

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

      const data = (await response.json()) as any

      if (!response.ok) {
        // Handle error response from backend
        const errorMessage =
          data.error || data.message || "Failed to activate subscription"
        const errorDetails = data.details
        const fullError = errorDetails
          ? `${errorMessage}: ${errorDetails}`
          : errorMessage
        console.error(
          "Backend error:",
          errorMessage,
          "Details:",
          errorDetails,
          data,
        )
        setError(fullError)

        // For failed activations, show error immediately but still update status
        // This gives instant feedback for Plan 2 (failing payments)
        setSubscriptionStatuses((prev) => ({
          ...prev,
          [selectedPlan]: {
            isSubscribed: false, // Backend confirmed it failed
            subscriptionOwner: subscription?.subscriptionPayer,
            subscriptionPayer: subscription?.subscriptionPayer,
          },
        }))

        // Still check status to update UI with actual onchain data
        setTimeout(async () => {
          await handleGetStatus(id, selectedPlan)
        }, 1000)
        return
      }

      console.log("Subscription activated:", data)

      // Extract the actual result from the wrapped response
      const result = data.data || data

      // Show success message with amount if available
      const successMessage = result.transaction_hash
        ? `Subscription activated successfully! Transaction: ${result.transaction_hash.slice(0, 10)}...`
        : "Subscription activated successfully!"
      setSuccess(successMessage)

      // Immediately show basic subscription status from backend
      // This gives instant feedback while blockchain processes
      setSubscriptionStatuses((prev) => ({
        ...prev,
        [selectedPlan]: {
          isSubscribed: true, // Backend confirmed activation
          subscriptionOwner: subscription?.subscriptionPayer,
          subscriptionPayer: subscription?.subscriptionPayer,
          transactionHash: result.transaction_hash, // Store the tx hash
          // We'll fetch the rest from onchain later
        },
      }))

      // Optional: Auto-fetch onchain status after a delay
      // User can also manually click to check onchain status
      setTimeout(async () => {
        await handleGetStatus(result.subscription_id || id, selectedPlan)
      }, 5000) // Give blockchain more time to process
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

  // Unsubscribe handler
  const handleUnsubscribe = async () => {
    if (!subscription?.id) {
      setError("No subscription to unsubscribe from")
      return
    }

    setLoading({ ...loading, unsubscribe: true })
    setError(null)
    setSuccess(null)

    try {
      // First fetch the permission to revoke
      const permission = await fetchPermission({
        permissionHash: subscription.id,
      })

      if (!permission) {
        setError("Could not find subscription to unsubscribe")
        return
      }

      console.log("Fetched permission for revoke:", permission)

      // // Get the provider from the SDK
      // const sdk = createBaseAccountSDK()
      // const provider = sdk.getProvider()

      // // requestRevoke expects an object with permission and provider
      // const hash = await requestRevoke({
      //   permission: permission,
      //   provider: provider
      // })
      // console.log("Revoke succeeded with hash:", hash)

      setSuccess("Successfully unsubscribed!")

      // Remove subscription from state and localStorage
      const updatedSubscriptions = { ...subscriptions }
      delete updatedSubscriptions[selectedPlan]
      setSubscriptions(updatedSubscriptions)
      localStorage.setItem(
        "bbq-subscriptions",
        JSON.stringify(updatedSubscriptions),
      )

      // Clear the status for this plan
      setSubscriptionStatuses((prev) => {
        const updated = { ...prev }
        delete updated[selectedPlan]
        return updated
      })
    } catch (err: any) {
      console.error("Unsubscribe failed:", err)
      // User might have rejected the transaction or it failed
      setError(err.message || "Unsubscribe was rejected or failed")
    } finally {
      setLoading({ ...loading, unsubscribe: false })
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

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl w-full">
          {/* Subscription Card */}
          <div className="glass-effect rounded-2xl p-8 shine-effect">
            <div className="relative z-10">
              {/* Plan Selector */}
              <div className="mb-6 flex gap-2">
                <button
                  onClick={() => {
                    setSelectedPlan("test")
                    // Load status for test plan if it exists
                    if (subscriptions.test) {
                      handleGetStatus(subscriptions.test.id, "test")
                    }
                  }}
                  className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                    selectedPlan === "test"
                      ? "bg-blue-500 text-white"
                      : "bg-white/10 text-white/60 hover:bg-white/20"
                  }`}
                >
                  Plan 1
                </button>
                <button
                  onClick={() => {
                    setSelectedPlan("pro")
                    // Load status for pro plan if it exists
                    if (subscriptions.pro) {
                      handleGetStatus(subscriptions.pro.id, "pro")
                    }
                  }}
                  className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                    selectedPlan === "pro"
                      ? "bg-purple-500 text-white"
                      : "bg-white/10 text-white/60 hover:bg-white/20"
                  }`}
                >
                  Plan 2
                </button>
              </div>

              <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-3xl font-bold text-white">
                    {PLANS[selectedPlan].name}
                  </h2>
                </div>
                <p className="text-white/80">
                  {PLANS[selectedPlan].description}
                </p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline">
                  <span className="text-5xl font-bold text-white">
                    {PLANS[selectedPlan].displayPrice}{" "}
                  </span>
                  <span className="text-white/70 ml-2">/day</span>
                </div>
                <p className="text-sm text-white/60 mt-2">
                  Billed daily in USDC
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
                  <span>Secure onchain transactions</span>
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

              {/* Subscribe/Unsubscribe buttons */}
              {subscription && subscriptionStatus?.isSubscribed ? (
                <button
                  onClick={handleUnsubscribe}
                  disabled={loading.unsubscribe}
                  className="w-full py-4 px-6 rounded-xl font-bold text-lg transition-all transform hover:scale-105 flex items-center justify-center space-x-2 bg-red-500 text-white hover:bg-red-600"
                >
                  {loading.unsubscribe ? (
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
                      <span>Unsubscribing...</span>
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
                        <path d="M6 18L18 6M6 6l12 12"></path>
                      </svg>
                      <span>Unsubscribe</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleCreateSubscription}
                  disabled={
                    loading.subscription ||
                    (!!subscription && subscriptionStatus?.isSubscribed)
                  }
                  className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all transform hover:scale-105 flex items-center justify-center space-x-2 ${
                    subscription && !subscriptionStatus?.isSubscribed
                      ? "bg-green-500 text-white hover:bg-green-600 pulse-glow"
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
                  ) : subscription && !subscriptionStatus?.isSubscribed ? (
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
                        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                      <span>Retry Subscribing</span>
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
              )}

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
                  onClick={() =>
                    handleGetStatus(subscription?.id, selectedPlan)
                  }
                  disabled={loading.status}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg glass-effect hover:bg-white/20 transition-all"
                  title="Fetch latest onchain subscription data"
                >
                  {loading.status ? (
                    <>
                      <svg
                        className="animate-spin h-4 w-4 text-white"
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
                      <span className="text-sm text-white/80">Checking...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4 text-white"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                      </svg>
                      <span className="text-sm text-white/80">
                        Check Onchain Status
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>

            {subscription ? (
              <div className="space-y-4">
                {/* Show loading spinner while processing subscription or if we don't have status yet */}
                {loading.charge ||
                loading.subscription ||
                !subscriptionStatus ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <svg
                      className="animate-spin h-12 w-12 text-white/60"
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
                    <div className="space-y-2 text-center">
                      <p className="text-white/60 text-lg">
                        Checkout in progress
                      </p>
                      <p className="text-white/40 text-sm">
                        {selectedPlan === "pro"
                          ? "Processing $100 first charge and activating subscription..."
                          : "Processing $0.0009 first charge and activating subscription..."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Show subscription ID after server response */}
                    <div className="bg-white/5 rounded-xl p-4">
                      <p className="text-sm text-white/60 mb-1">
                        Subscription ID
                      </p>
                      <p className="font-mono text-sm text-white/90 break-all">
                        {subscription.id}
                      </p>
                    </div>

                    {/* Status Badge - Show actual status */}
                    {subscriptionStatus !== null && (
                      <div className="flex items-center justify-between p-4 bg-white/10 rounded-xl">
                        <div className="flex items-center space-x-3">
                          {subscriptionStatus.isSubscribed ? (
                            <>
                              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                              <span className="font-semibold text-green-400">
                                Active Subscription
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                              <span className="font-semibold text-white">
                                Subscription Revoked
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Show basic subscription details after server response */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white/5 rounded-xl p-3">
                        <p className="text-xs text-white/60 mb-1">
                          Monthly Charge
                        </p>
                        <p className="font-semibold text-white">
                          ${subscription.recurringCharge} USDC
                        </p>
                      </div>
                      <div className="bg-white/5 rounded-xl p-3">
                        <p className="text-xs text-white/60 mb-1">
                          Billing Period
                        </p>
                        <p className="font-semibold text-white">
                          {subscription.periodInDays} days
                        </p>
                      </div>
                    </div>

                    {/* Show onchain data only after fetching */}
                    {subscriptionStatus !== null && (
                      <>
                        {subscriptionStatus.isSubscribed ? (
                          <>
                            {subscriptionStatus.remainingChargeInPeriod !==
                              undefined && (
                              <div className="bg-purple-500/20 rounded-xl p-4">
                                <p className="text-sm text-purple-200 mb-1">
                                  Remaining in Period
                                </p>
                                <div className="flex items-baseline space-x-2 mb-2">
                                  <p className="text-2xl font-bold text-white">
                                    $
                                    {subscriptionStatus.remainingChargeInPeriod}
                                  </p>
                                  <span className="text-sm text-white/60">
                                    USDC
                                  </span>
                                </div>
                                {(subscriptionStatus as any)
                                  .transactionHash && (
                                  <a
                                    href={`https://sepolia.basescan.org/tx/${(subscriptionStatus as any).transactionHash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center space-x-1 text-xs text-purple-300 hover:text-purple-200 transition-colors"
                                  >
                                    <span>View transaction</span>
                                    <svg
                                      className="w-3 h-3"
                                      fill="none"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth="2"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                    </svg>
                                  </a>
                                )}
                              </div>
                            )}

                            {subscriptionStatus.nextPeriodStart && (
                              <div className="bg-white/5 rounded-xl p-4">
                                <p className="text-sm text-white/60 mb-1">
                                  Next Billing Date
                                </p>
                                <p className="font-semibold text-white">
                                  {subscriptionStatus.nextPeriodStart instanceof
                                  Date
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
                        ) : (
                          <>
                            {error && (
                              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                                <div className="flex items-start space-x-3">
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
                                  <div className="flex-1">
                                    <p className="text-white font-semibold text-sm mb-1">
                                      Subscription Issue
                                    </p>
                                    <p className="text-white/80 text-sm">
                                      {typeof error === "string"
                                        ? error
                                        : error?.message}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}

                    {subscription && (
                      <div className="bg-white/5 rounded-xl p-3">
                        <p className="text-xs text-white/60 mb-1">
                          Subscription Payer
                        </p>
                        <p className="font-mono text-xs text-white/90 break-all">
                          {subscription.subscriptionPayer}
                        </p>
                      </div>
                    )}
                  </>
                )}
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
