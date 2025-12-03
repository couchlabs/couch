import { base } from "@base-org/account"
import { Check, Copy, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "../components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card"
import { Separator } from "../components/ui/separator"
import { useWebSocket } from "../hooks/useWebSocket"
import { formatPeriod } from "../lib/formatPeriod"

interface WebhookEventData {
  type: string
  created_at: number
  data: {
    subscription: {
      id: string
      status: string
      amount: string
      period_in_seconds: number
    }
    order?: {
      number: number
      type: string
      amount: string
      status: string
      current_period_start: number
      current_period_end: number
    }
    transaction?: {
      hash: string
      amount: string
      processed_at: number
    }
    error?: {
      code: string
      message: string
    }
  }
}

type PageState = "initial" | "processing" | "success" | "error"

export const Checkout = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { lastMessage } = useWebSocket()

  // Query params
  const beneficiary = searchParams.get("beneficiary")
  const amount = searchParams.get("amount")
  const period = searchParams.get("period")
  const successUrl = searchParams.get("successUrl")
  const testnet = searchParams.get("testnet") === "true"

  // State
  const [pageState, setPageState] = useState<PageState>("initial")
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Refs for timeout handling
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Validate query params on mount
  useEffect(() => {
    // Beneficiary is required and must be a valid address
    const isValidAddress =
      beneficiary && /^0x[a-fA-F0-9]{40}$/.test(beneficiary)
    const isValidAmount =
      amount && !Number.isNaN(parseFloat(amount)) && parseFloat(amount) > 0
    const isValidPeriod =
      period && !Number.isNaN(parseFloat(period)) && parseFloat(period) > 0

    if (!isValidAddress || !isValidAmount || !isValidPeriod) {
      navigate("/checkout-instructions")
    }
  }, [beneficiary, amount, period, navigate])

  // Listen for webhook events
  useEffect(() => {
    if (!subscriptionId || !lastMessage) return

    try {
      const message =
        typeof lastMessage === "string" ? JSON.parse(lastMessage) : lastMessage

      // Check if this is a webhook event for our subscription
      if (message.type === "webhook_event" && message.data) {
        // message.data is a WebhookEvent object with event_data as a JSON string
        const webhookEventRecord = message.data

        // Parse the event_data JSON string to get the actual webhook event
        const webhookEvent: WebhookEventData = JSON.parse(
          webhookEventRecord.event_data,
        )

        // Check if this event is for our subscription
        if (
          webhookEvent.type === "subscription.updated" &&
          webhookEvent.data?.subscription?.id === subscriptionId
        ) {
          const status = webhookEvent.data.subscription.status

          // Clear timeout
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
          }

          if (status === "active") {
            // Success! Redirect if successUrl provided
            setPageState("success")
            if (successUrl) {
              // Validate URL before redirecting
              try {
                new URL(successUrl)
                window.location.href = successUrl
              } catch {
                // Invalid URL, just show success message
              }
            }
          } else if (status === "incomplete") {
            // Activation failed
            const errorMsg =
              webhookEvent.data.error?.message ||
              "Subscription activation failed"
            setErrorMessage(errorMsg)
            setPageState("error")
          }
        }
      }
    } catch (error) {
      console.error("Error parsing webhook event:", error)
    }
  }, [lastMessage, subscriptionId, successUrl])

  // Handle subscription creation
  const handleSubscribe = async () => {
    if (!beneficiary || !amount || !period) return

    setPageState("processing")
    setErrorMessage("")

    try {
      // Parse period value - can be days or seconds depending on URL params
      const periodValue = parseFloat(period)

      // Get spender address from env (set by alchemy.run.ts)
      // This is ALWAYS the subscription owner (the wallet that gets permission to charge)
      const spenderAddress = import.meta.env.VITE_COUCH_SPENDER_ADDRESS
      if (!spenderAddress) {
        throw new Error("VITE_COUCH_SPENDER_ADDRESS not set")
      }

      // Create subscription using Base SDK
      // The user (payer) is whoever connects their Coinbase Wallet
      // The subscriptionOwner is always the backend spender wallet
      const subscriptionOptions = {
        recurringCharge: amount,
        subscriptionOwner: spenderAddress, // Always use spender address as owner
        testnet,
        ...(testnet
          ? { overridePeriodInSecondsForTestnet: Math.floor(periodValue) } // For testnet, period can be in seconds
          : { periodInDays: Math.ceil(periodValue) }), // For mainnet, period is in days
        // biome-ignore lint/suspicious/noExplicitAny: Base SDK type doesn't properly support conditional parameters
      } as any

      const subscription =
        await base.subscription.subscribe(subscriptionOptions)

      setSubscriptionId(subscription.id)

      // Activate subscription via backend
      // Beneficiary is the merchant account where payouts will be sent
      const response = await fetch("/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: subscription.id,
          provider: "base",
          beneficiary: beneficiary,
          testnet,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to activate subscription")
      }

      // Start 60-second timeout
      timeoutRef.current = setTimeout(() => {
        setErrorMessage(
          "Subscription activation timed out. Please check your transaction.",
        )
        setPageState("error")
      }, 60000) // 60 seconds
    } catch (error) {
      console.error("Subscription error:", error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to create subscription",
      )
      setPageState("error")
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Copy address to clipboard
  const handleCopy = async () => {
    if (beneficiary) {
      await navigator.clipboard.writeText(beneficiary)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Format address for display (truncate middle)
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  // Don't render until validation is complete
  if (!beneficiary || !amount || !period) {
    return null
  }

  // For testnet, period might already be in seconds; for mainnet, it's in days
  const periodInSeconds = testnet
    ? Math.floor(parseFloat(period)) // Testnet: period is in seconds
    : Math.floor(parseFloat(period) * 86400) // Mainnet: period is in days, convert to seconds

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">Couch Checkout</h1>
          <p className="text-muted-foreground mt-2">
            One-click subscription demo
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
            <CardDescription>
              Review and confirm your subscription
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  Beneficiary
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">
                    {formatAddress(beneficiary)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleCopy}
                    disabled={pageState === "processing"}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <Separator className="border-t border-dashed border-border bg-transparent" />

              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  Amount
                </span>
                <span className="text-sm font-semibold">{amount} USDC</span>
              </div>

              <Separator className="border-t border-dashed border-border bg-transparent" />

              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  Charged every
                </span>
                <span className="text-sm font-semibold">
                  {formatPeriod(periodInSeconds)}
                </span>
              </div>

              <Separator className="border-t border-dashed border-border bg-transparent" />
            </div>

            {pageState === "processing" && (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Processing subscription...
                </p>
              </div>
            )}

            {pageState === "success" && !successUrl && (
              <Button
                disabled
                className="w-full bg-green-600 hover:bg-green-600 text-white"
              >
                <Check className="mr-2 h-4 w-4" />
                Subscription Active
              </Button>
            )}

            {pageState === "error" && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-md p-4">
                <p className="text-sm text-red-800 dark:text-red-200">
                  {errorMessage}
                </p>
              </div>
            )}
          </CardContent>
          <CardFooter>
            {pageState !== "processing" && pageState !== "success" && (
              <Button onClick={handleSubscribe} className="w-full">
                Subscribe
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
