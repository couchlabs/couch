import { Check, Copy, ExternalLink } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { NetworkSelector } from "../components/NetworkSelector"
import { Button } from "../components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import { useNetwork } from "../store/NetworkContext"

export const CheckoutInstructions = () => {
  const { network } = useNetwork()
  const isTestnet = network === "testnet"

  const [beneficiary, setBeneficiary] = useState("")
  const [amount, setAmount] = useState("0.0001")
  const [periodValue, setPeriodValue] = useState("1")
  const [periodUnit, setPeriodUnit] = useState<
    "seconds" | "minutes" | "hours" | "days"
  >("seconds")
  const [successUrl, setSuccessUrl] = useState("")
  const [copied, setCopied] = useState(false)

  // Filter period units based on network
  const periodUnits = isTestnet
    ? ["seconds", "minutes", "hours", "days"]
    : ["days"]

  // Reset period unit when switching networks
  useEffect(() => {
    if (!isTestnet && periodUnit !== "days") {
      // Switching to mainnet: reset to 'days'
      setPeriodUnit("days")
    } else if (isTestnet && periodUnit === "days") {
      // Switching to testnet: reset to 'seconds' for better testing UX
      setPeriodUnit("seconds")
    }
  }, [isTestnet, periodUnit])

  // Generate unique IDs for form fields
  const beneficiaryId = useId()
  const amountId = useId()
  const successUrlId = useId()

  // Convert period to appropriate unit for the URL
  const convertPeriod = (): string => {
    const value = parseFloat(periodValue)

    // For testnet with non-day units, convert to seconds
    if (isTestnet && periodUnit !== "days") {
      switch (periodUnit) {
        case "seconds":
          return value.toString()
        case "minutes":
          return (value * 60).toString()
        case "hours":
          return (value * 60 * 60).toString()
        default:
          return value.toString()
      }
    }

    // For mainnet or testnet with days, convert to days
    switch (periodUnit) {
      case "seconds":
        return (value / 86400).toString() // 86400 seconds in a day
      case "minutes":
        return (value / 1440).toString() // 1440 minutes in a day
      case "hours":
        return (value / 24).toString()
      case "days":
        return value.toString()
      default:
        return value.toString()
    }
  }

  // Generate the checkout URL
  const generateUrl = (): string => {
    const params = new URLSearchParams()

    params.append("beneficiary", beneficiary)
    params.append("amount", amount)
    params.append("period", convertPeriod())
    if (successUrl) params.append("successUrl", successUrl)
    if (isTestnet) params.append("testnet", "true")

    return `${window.location.origin}/checkout?${params.toString()}`
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(generateUrl())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleOpenCheckout = () => {
    window.open(generateUrl(), "_blank")
  }

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Checkout Link Generator</h1>
            <p className="text-muted-foreground mt-2">
              Create custom checkout links for subscription payments
            </p>
          </div>
          <NetworkSelector />
        </div>

        <div className="grid gap-6 lg:grid-cols-[450px_1fr]">
          {/* Left column - Link Generator */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Generate Checkout Link</CardTitle>
                <CardDescription>
                  Configure your subscription parameters
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Beneficiary */}
                <div className="space-y-2">
                  <Label htmlFor={beneficiaryId}>Beneficiary Address</Label>
                  <Input
                    id={beneficiaryId}
                    type="text"
                    placeholder="0x..."
                    value={beneficiary}
                    onChange={(e) => setBeneficiary(e.target.value)}
                    className="placeholder:text-muted-foreground/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Merchant account where payouts will be sent
                  </p>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <Label htmlFor={amountId}>Amount (USDC)</Label>
                  <Input
                    id={amountId}
                    type="text"
                    placeholder="0.0001"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>

                {/* Period */}
                <div className="space-y-2">
                  <Label>Billing Period</Label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="1"
                      value={periodValue}
                      onChange={(e) => setPeriodValue(e.target.value)}
                      className="flex-1"
                    />
                    <Select
                      value={periodUnit}
                      onValueChange={(value) =>
                        setPeriodUnit(value as typeof periodUnit)
                      }
                    >
                      <SelectTrigger className="w-32">
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
                </div>

                {/* Success URL */}
                <div className="space-y-2">
                  <Label htmlFor={successUrlId}>
                    Success URL{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id={successUrlId}
                    type="url"
                    placeholder="https://example.com/success"
                    value={successUrl}
                    onChange={(e) => setSuccessUrl(e.target.value)}
                    className="placeholder:text-muted-foreground/50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Redirect users here after successful activation
                  </p>
                </div>

                {/* Generated URL */}
                <div className="space-y-2">
                  <Label>Generated URL</Label>
                  <div className="flex gap-2">
                    <Input
                      value={generateUrl()}
                      readOnly
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                      title="Copy to clipboard"
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleOpenCheckout}
                    className="flex-1"
                    disabled={!beneficiary || !amount || !periodValue}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Checkout
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column - Documentation */}
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>How It Works</CardTitle>
                <CardDescription>
                  Accept subscription payments with a simple link
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">1. Generate Your Link</h3>
                  <p className="text-sm text-muted-foreground">
                    Configure your subscription parameters and generate a custom
                    checkout URL.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">2. Share the Link</h3>
                  <p className="text-sm text-muted-foreground">
                    Send the checkout link to your users via email, embed it on
                    your website, or use it anywhere.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">3. User Subscribes</h3>
                  <p className="text-sm text-muted-foreground">
                    Users click the link, review the subscription details, and
                    approve with their Coinbase Wallet.
                  </p>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">4. Automatic Redirect</h3>
                  <p className="text-sm text-muted-foreground">
                    After successful activation, users are automatically
                    redirected to your success URL.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>URL Parameters</CardTitle>
                <CardDescription>Available query parameters</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    beneficiary
                  </code>
                  <p className="text-sm text-muted-foreground mt-1">
                    Required. Merchant wallet address where payouts will be
                    sent.
                  </p>
                </div>

                <div>
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    amount
                  </code>
                  <p className="text-sm text-muted-foreground mt-1">
                    Required. Subscription amount in USDC (e.g., "0.0001").
                  </p>
                </div>

                <div>
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    period
                  </code>
                  <p className="text-sm text-muted-foreground mt-1">
                    Required. Billing period in days. Supports decimals for
                    testing (e.g., "0.5" = 12 hours).
                  </p>
                </div>

                <div>
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    successUrl
                  </code>
                  <p className="text-sm text-muted-foreground mt-1">
                    Optional. Redirect URL after successful subscription
                    activation.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
