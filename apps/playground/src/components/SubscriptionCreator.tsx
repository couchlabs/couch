import { base } from "@base-org/account"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useNetwork } from "@/store/NetworkContext"

export function SubscriptionCreator() {
  const { network } = useNetwork()
  const isTestnet = network === "testnet"

  const [chargeAmount, setChargeAmount] = useState("0.0001")
  const [periodValue, setPeriodValue] = useState("60")
  const [periodUnit, setPeriodUnit] = useState<
    "seconds" | "minutes" | "hours" | "days"
  >("seconds")
  const [isSubscribing, setIsSubscribing] = useState(false)
  const prevNetworkRef = useRef<"testnet" | "mainnet">(network)

  // Filter period units based on network
  const periodUnits = isTestnet
    ? ["seconds", "minutes", "hours", "days"]
    : ["days"]

  // Reset period unit when switching networks
  useEffect(() => {
    // Only reset if network actually changed
    if (prevNetworkRef.current !== network) {
      if (!isTestnet && periodUnit !== "days") {
        // Switching to mainnet: reset to 'days'
        setPeriodUnit("days")
      } else if (isTestnet && periodUnit === "days") {
        // Switching to testnet: reset to 'seconds' for better testing UX
        setPeriodUnit("seconds")
      }
      prevNetworkRef.current = network
    }
  }, [network, isTestnet, periodUnit])

  // Dynamic width calculation with minimum sizes
  const getAmountWidth = () => {
    const chars = Math.max(chargeAmount.length, 3) // Allow shrinking down to 3 chars min
    return `${chars + 2}ch`
  }

  const getPeriodWidth = () => {
    const chars = Math.max(periodValue.length, 2)
    return `${chars + 3}ch`
  }

  const handleSubscribe = async () => {
    setIsSubscribing(true)

    try {
      // Get backend wallet address from env
      const accountAddress = import.meta.env.VITE_COUCH_SPENDER_ADDRESS
      if (!accountAddress) {
        throw new Error("VITE_COUCH_SPENDER_ADDRESS not set")
      }

      // Convert period to seconds
      const periodInSeconds = convertPeriodToSeconds(
        Number(periodValue),
        periodUnit,
      )

      // Create subscription via Coinbase Wallet
      const subscriptionOptions = {
        recurringCharge: chargeAmount, // USDC amount
        subscriptionOwner: accountAddress, // Backend wallet address (spender)
        testnet: isTestnet, // Use network from context
        ...(isTestnet && periodUnit !== "days"
          ? { overridePeriodInSecondsForTestnet: periodInSeconds } // For testing with short periods
          : { periodInDays: Math.ceil(periodInSeconds / 86400) }), // Convert to days for mainnet
        // biome-ignore lint/suspicious/noExplicitAny: Base SDK type doesn't properly support conditional parameters
      } as any

      const subscription =
        await base.subscription.subscribe(subscriptionOptions)

      // Use service binding through our /activate endpoint (RPC-style)
      const response = await fetch("/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: subscription.id,
          provider: "base",
          testnet: isTestnet, // Use network from context
        }),
      })

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(
          errorData.error ||
            errorData.message ||
            `Failed to activate subscription: ${response.statusText}`,
        )
      }

      await response.json() // Confirm response was parsed successfully

      // Success - reset loading state
      setIsSubscribing(false)
    } catch (error) {
      console.error("Failed to create subscription:", error)
      alert(
        `Failed to create subscription: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
      setIsSubscribing(false)
    }
  }

  const convertPeriodToSeconds = (
    value: number,
    unit: typeof periodUnit,
  ): number => {
    switch (unit) {
      case "seconds":
        return value
      case "minutes":
        return value * 60
      case "hours":
        return value * 60 * 60
      case "days":
        return value * 60 * 60 * 24
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create Subscription</CardTitle>
        <Separator className="my-4" />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Conversational UI - single line */}
        <div className="flex items-center gap-2 text-sm font-mono">
          <span>Charge</span>
          <Input
            type="text"
            value={chargeAmount}
            onChange={(e) => setChargeAmount(e.target.value)}
            className="h-8 text-center text-sm font-mono px-2 transition-all duration-75"
            style={{ width: getAmountWidth() }}
            placeholder="0.001"
          />
          <span className="text-muted-foreground">USDC</span>
          <span>every</span>
          <Input
            type="text"
            value={periodValue}
            onChange={(e) => setPeriodValue(e.target.value)}
            className="h-8 text-center text-sm font-mono px-2 transition-all duration-75"
            style={{ width: getPeriodWidth() }}
            placeholder="30"
          />
          <Select
            value={periodUnit}
            onValueChange={(value) => setPeriodUnit(value as typeof periodUnit)}
          >
            <SelectTrigger size="sm" className="px-2 text-sm font-mono w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodUnits.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          size="lg"
          onClick={handleSubscribe}
          disabled={isSubscribing || !chargeAmount || !periodValue}
        >
          {isSubscribing ? "Creating..." : "Subscribe"}
        </Button>
      </CardFooter>
    </Card>
  )
}
