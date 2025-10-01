import { Hono } from "hono"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { AccountService } from "@/services/account.service"
import type { WorkerEnv } from "@/types/api.env"

export const accountRoutes = new Hono<{ Bindings: WorkerEnv }>()

/**
 * PUT /api/account
 * Creates a new account or rotates the API key for an existing account
 * Returns the API key
 */
accountRoutes.put("/", async (c) => {
  const body = await c.req.json<{ address?: string }>()
  const address = body.address

  if (!address) {
    throw new HTTPError(400, ErrorCode.INVALID_REQUEST, "address is required")
  }

  const accountService = new AccountService()
  const account = await accountService.createOrRotateAccount({ address })

  return c.json({
    api_key: account.apiKey,
  })
})
