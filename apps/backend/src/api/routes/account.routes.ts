import { Hono } from "hono"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { AccountRepository } from "@/repositories/account.repository"
import { AccountService } from "@/services/account.service"
import type { WorkerEnv } from "@/types/api.env"

export const accountRoutes = new Hono<{ Bindings: WorkerEnv }>()

/**
 * PUT /api/account
 * Creates a new account or rotates the API key for an existing account
 */
accountRoutes.put("/", async (c) => {
  const body = await c.req.json<{ address?: string }>()

  if (!body.address) {
    throw new HTTPError(400, ErrorCode.INVALID_REQUEST, "address is required")
  }

  const accountService = new AccountService({
    accountRepository: new AccountRepository({
      db: c.env.DB,
    }),
    stage: c.env.STAGE,
  })

  // Create or rotate account
  const result = await accountService.createOrRotateAccount({
    evmAddress: body.address,
  })

  // Return the new API key
  return c.json({
    api_key: result.apiKey,
  })
})
