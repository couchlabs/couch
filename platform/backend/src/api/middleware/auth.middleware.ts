import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import type { Account } from "@backend/repositories/account.repository"
import { AccountService } from "@backend/services/account.service"
import type { ApiWorkerEnv } from "@backend-types/api.env"
import type { MiddlewareHandler } from "hono"

/**
 * Context with authenticated user information
 */
export interface AuthContext {
  account: Account
}

/**
 * API Key authentication middleware
 * Validates Authorization: Bearer header and adds full account (id + address) to context
 */
export const apiKeyAuth = (): MiddlewareHandler<{
  Bindings: ApiWorkerEnv
  Variables: { auth: AuthContext }
}> => {
  return async function apiKeyAuthHandler(c, next) {
    const authHeader = c.req.header("Authorization")
    const apiKey = authHeader?.replace("Bearer ", "")

    if (!apiKey) {
      throw new HTTPError(401, ErrorCode.UNAUTHORIZED, "Missing API key")
    }

    const accountService = new AccountService(c.env)
    const account = await accountService.authenticateApiKey(apiKey)
    c.set("auth", { account })
    await next()
  }
}
