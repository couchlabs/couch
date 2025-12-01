import type { MiddlewareHandler } from "hono"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import type { Account } from "@/repositories/account.repository"
import { AccountService } from "@/services/account.service"
import type { WorkerEnv } from "@/types/api.env"

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
  Bindings: WorkerEnv
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
