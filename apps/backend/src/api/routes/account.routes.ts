import { Hono } from "hono"
import { AccountService } from "@/services/account.service"
import { AccountRepository } from "@/repositories/account.repository"
import { HTTPError, ErrorCode } from "@/api/errors"
import type { WorkerEnv } from "@/types/api.env"

export const accountRoutes = new Hono<{ Bindings: WorkerEnv }>()

/**
 * PUT /api/account
 * Creates a new account or rotates the API key for an existing account
 */
accountRoutes.put("/", async (c) => {
  // Parse request body
  const body = await c.req.json<{ evm_address?: string }>()

  if (!body.evm_address) {
    throw new HTTPError(
      400,
      ErrorCode.INVALID_REQUEST,
      "evm_address is required",
    )
  }

  const accountService = new AccountService({
    accountRepository: new AccountRepository({
      db: c.env.DB,
    }),
    stage: c.env.STAGE,
  })

  // Create or rotate account
  const result = await accountService.createOrRotateAccount({
    evmAddress: body.evm_address,
  })

  // Return the new API key
  return c.json({
    api_key: result.apiKey,
  })
})
