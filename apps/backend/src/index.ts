import type { backend } from "../alchemy.run.js"

import { CdpClient } from "@coinbase/cdp-sdk"
import { base } from "@base-org/account"
import { parseEther } from "viem"
import { env } from "cloudflare:workers"

const cdp = new CdpClient({
  apiKeyId: env.CDP_API_KEY_ID,
  apiKeySecret: env.CDP_API_KEY_SECRET,
  walletSecret: env.CDP_WALLET_SECRET,
})

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
}

export default {
  fetch: async (request) => {
    const url = new URL(request.url)

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, { headers })
    }

    if (url.pathname.startsWith("/api/charge-subscription")) {
      const { subscriptionId } = await request.json<{
        subscriptionId: string
      }>()

      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "Missing subscriptionId" }),
          {
            status: 400,
            headers: {
              ...headers,
              "Content-Type": "application/json",
            },
          },
        )
      }

      try {
        const owner = await cdp.evm.getAccount({
          name: process.env.CDP_ACCOUNT_OWNER_NAME,
        })
        const smartAccount = await cdp.evm.getSmartAccount({
          owner,
          name: process.env.CDP_SMART_ACCOUNT_NAME,
        })

        // Simply attempt to charge $1 without checking status first
        const chargeAmount = 1.0

        // Prepare charge transaction for $1
        const chargeCalls = await base.subscription.prepareCharge({
          id: subscriptionId,
          amount: chargeAmount.toString(),
          testnet: true,
        })

        console.log("Sending user operation")
        const { userOpHash } = await cdp.evm.sendUserOperation({
          smartAccount,
          network: "base-sepolia",
          calls: chargeCalls.map((call) => {
            call.value = parseEther("0") as any // HACK as it oddly fails without this
            return call
          }) as any,
        })

        console.log("Waiting for user operation to be confirmed...")
        const userOperationResult = await smartAccount.waitForUserOperation({
          userOpHash,
        })

        console.log(
          `Charged ${chargeAmount.toFixed(2)} USDC: ${
            userOperationResult.userOpHash
          }`,
        )

        return Response.json(
          {
            success: userOperationResult.status === "complete",
            transactionHash: userOperationResult.userOpHash,
            amount: chargeAmount.toFixed(2),
            message: `Successfully charged $${chargeAmount.toFixed(2)} USDC`,
          },
          { headers },
        )
      } catch (error) {
        console.error("Charge failed:", error)

        // Handle gas-related errors
        if (
          error.message?.includes("insufficient funds") ||
          error.message?.includes("insufficient balance") ||
          error.message?.includes("gas required exceeds") ||
          error.message?.includes("AA21") || // UserOp reverted - insufficient funds for gas
          error.message?.includes("AA40") || // Over verification gas limit
          error.message?.includes("prefund") ||
          error.message?.toLowerCase().includes("gas")
        ) {
          return Response.json(
            {
              success: false,
              error: "Insufficient Gas",
              message: "The server wallet needs Base Sepolia ETH for gas fees",
              details:
                "Please add Base Sepolia ETH to the server wallet address shown above to execute subscription charges.",
              originalError: error.message,
            },
            { status: 400, headers },
          )
        }

        // Handle charge limit errors
        if (error.message?.includes("exceeds")) {
          return Response.json(
            {
              success: false,
              error: "Charge Limit Exceeded",
              message:
                "The charge amount exceeds the remaining allowance for this period",
              details: error.message,
            },
            { status: 400, headers },
          )
        }

        // Handle subscription status errors
        if (
          error.message?.includes("revoked") ||
          error.message?.includes("cancelled")
        ) {
          return Response.json(
            {
              success: false,
              error: "Subscription Inactive",
              message: "The subscription has been cancelled or revoked",
              details: error.message,
            },
            { status: 400, headers },
          )
        }

        return Response.json(
          {
            success: false,
            error: "Transaction Failed",
            message: error.message || "Failed to charge subscription",
            details: "An unexpected error occurred while processing the charge",
          },
          { status: 500, headers },
        )
      }
    } else {
      return new Response("hello", { status: 404, headers })
    }
  },
} as ExportedHandler<typeof backend.Env>
