import { createMiddleware } from "hono/factory"
import type { Address, Hash } from "viem"
import { isAddress } from "viem"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { Provider } from "@/providers/provider.interface"

export interface SubscriptionContext {
  subscriptionId: Hash
  provider: Provider
  beneficiary?: Address // Optional - defaults to accountAddress if not provided
}

export const subscriptionBody = () =>
  createMiddleware<{
    Variables: { subscription: SubscriptionContext }
  }>(async (ctx, next) => {
    const body = await ctx.req.json<{
      id?: Hash
      provider?: string
      beneficiary?: string
    }>()

    const { id, provider, beneficiary } = body

    if (!id) {
      throw new HTTPError(400, ErrorCode.MISSING_FIELD, "id is required")
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

    // Validate beneficiary address if provided
    if (beneficiary && !isAddress(beneficiary)) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Invalid beneficiary address format",
      )
    }

    ctx.set("subscription", {
      subscriptionId: id,
      provider: provider as Provider,
      beneficiary: beneficiary as Address | undefined,
    })

    await next()
  })
