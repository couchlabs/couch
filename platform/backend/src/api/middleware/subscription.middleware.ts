import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import { Provider } from "@backend/providers/provider.interface"
import { createMiddleware } from "hono/factory"
import type { Address, Hash } from "viem"
import { isAddress, isHash } from "viem"

// Context for subscriptionParam middleware (only subscriptionId from URL)
export interface SubscriptionParamContext {
  subscriptionId: Hash
}

// Context for subscriptionBody middleware (subscriptionId, provider, testnet, optional beneficiary from body)
export interface SubscriptionBodyContext {
  subscriptionId: Hash
  provider: Provider
  testnet: boolean
  beneficiary?: Address
}

export const subscriptionBody = () =>
  createMiddleware<{
    Variables: { subscription: SubscriptionBodyContext }
  }>(async (ctx, next) => {
    const body = await ctx.req.json<{
      id?: Hash
      provider?: string
      testnet?: boolean
      beneficiary?: string
    }>()

    const { id, provider, testnet = false, beneficiary } = body

    if (!id) {
      throw new HTTPError(400, ErrorCode.MISSING_FIELD, "id is required")
    }

    if (!provider) {
      throw new HTTPError(400, ErrorCode.MISSING_FIELD, "provider is required")
    }

    // Validate testnet is boolean if provided
    if (testnet !== undefined && typeof testnet !== "boolean") {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "testnet must be a boolean",
      )
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
      testnet,
      beneficiary: beneficiary as Address | undefined,
    })

    await next()
  })

export const subscriptionParam = () =>
  createMiddleware<{
    Variables: { subscription: SubscriptionParamContext }
  }>(async (ctx, next) => {
    const id = ctx.req.param("id")

    if (!id) {
      throw new HTTPError(
        400,
        ErrorCode.MISSING_FIELD,
        "Subscription ID is required",
      )
    }

    if (!isHash(id)) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Invalid subscription ID format",
      )
    }

    ctx.set("subscription", { subscriptionId: id })

    await next()
  })
