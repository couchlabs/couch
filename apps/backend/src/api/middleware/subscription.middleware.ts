import { createMiddleware } from "hono/factory"
import type { Hash } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { Provider } from "@/providers"

export interface SubscriptionContext {
  subscriptionId: Hash
  providerId: Provider
}

export const subscriptionBody = () =>
  createMiddleware<{
    Variables: { subscription: SubscriptionContext }
  }>(async (ctx, next) => {
    const body = await ctx.req.json<{
      subscription_id?: Hash
      provider?: string
    }>()

    const subscriptionId = body.subscription_id
    const provider = body.provider

    if (!subscriptionId) {
      throw new HTTPError(
        400,
        ErrorCode.MISSING_FIELD,
        "subscription_id is required",
      )
    }

    if (!provider) {
      throw new HTTPError(400, ErrorCode.MISSING_FIELD, "provider is required")
    }

    if (!Object.values(Provider).includes(provider as Provider)) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        `Invalid provider. Supported providers: ${Object.values(Provider).join(", ")}`,
      )
    }

    ctx.set("subscription", {
      subscriptionId,
      providerId: provider as Provider,
    })

    await next()
  })
