import type { MiddlewareHandler } from "hono"
import { HTTPError, ErrorCode } from "@/api/errors"
import { AccountService } from "@/services/account.service"
import { AccountRepository } from "@/repositories/account.repository"
import type { WorkerEnv } from "@/types/api.env"
import type { Address } from "viem"

/**
 * Context with authenticated user information
 */
export interface AuthContext {
  accountAddress: Address
}

/**
 * API Key authentication middleware
 * Validates X-API-Key header and adds account address to context
 */
export const apiKeyAuth = (): MiddlewareHandler<{
  Bindings: WorkerEnv
  Variables: { auth: AuthContext }
}> => {
  return async function apiKeyAuthHandler(c, next) {
    const apiKey = c.req.header("X-API-Key")

    if (!apiKey) {
      throw new HTTPError(401, ErrorCode.UNAUTHORIZED, "Missing API key")
    }

    const accountService = new AccountService({
      accountRepository: new AccountRepository({
        db: c.env.DB,
      }),
      stage: c.env.STAGE,
    })

    const accountAddress = await accountService.authenticateApiKey(apiKey)
    c.set("auth", { accountAddress })
    await next()
  }
}
