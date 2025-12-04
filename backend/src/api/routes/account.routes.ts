import { Hono } from "hono"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { AccountService } from "@/services/account.service"
import type { WorkerEnv } from "@/types/api.env"

export const accountRoutes = new Hono<{ Bindings: WorkerEnv }>()

/**
 * POST /v1/account
 * Creates a new account (only if allowlisted and doesn't exist)
 * Returns the API key (one-time only)
 */
accountRoutes.post("/", async (c) => {
  const body = await c.req.json<{ address?: string }>()
  const address = body.address

  if (!address) {
    throw new HTTPError(400, ErrorCode.INVALID_REQUEST, "address is required")
  }

  const accountService = new AccountService(c.env)
  const result = await accountService.createAccount({ address })

  return c.json(
    {
      api_key: result.apiKey,
      subscription_owner: result.subscriptionOwnerWalletAddress,
    },
    201,
  )
})
