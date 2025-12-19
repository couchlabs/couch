import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import { Provider } from "@backend/providers/provider.interface"
import { AccountRepository } from "@backend/repositories/account.repository"
import { OnchainRepository } from "@backend/repositories/onchain.repository"
import { SubscriptionService } from "@backend/services/subscription.service"
import { WebhookService } from "@backend/services/webhook.service"
import type { ApiWorkerEnv } from "@backend-types/api.env"
import { Hono } from "hono"
import { rateLimiter } from "hono-rate-limiter"
import { type Address, getAddress, isAddress, keccak256, toHex } from "viem"

export const merchantRoutes = new Hono<{ Bindings: ApiWorkerEnv }>()

/**
 * GET /v1/merchant/test-rate-limit
 * TEMPORARY TEST ENDPOINT - Direct test of rate limiting binding
 * TODO: Remove this before production deployment
 */
merchantRoutes.get("/test-rate-limit", async (ctx) => {
  try {
    const ip = ctx.req.header("cf-connecting-ip") ?? "no-ip"
    const testKey = "direct-test-key"

    console.log("[TEST] Direct binding test - IP:", ip)
    console.log("[TEST] Binding exists:", !!ctx.env.OPEN_RATE_LIMIT)

    const result = await ctx.env.OPEN_RATE_LIMIT.limit({ key: testKey })

    console.log("[TEST] Result:", result)

    return ctx.json({
      success: result.success,
      ip,
      testKey,
      bindingExists: !!ctx.env.OPEN_RATE_LIMIT,
      message: result.success ? "Request allowed" : "Rate limited!",
    })
  } catch (error) {
    console.error("[TEST] Error:", error)
    return ctx.json(
      {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      500,
    )
  }
})

// Rate limiting
merchantRoutes.use(
  rateLimiter<{ Bindings: ApiWorkerEnv }>({
    binding: (c) => {
      console.log("[DEBUG] Rate limiter binding:", !!c.env.OPEN_RATE_LIMIT)
      return c.env.OPEN_RATE_LIMIT
    },
    keyGenerator: (c) => {
      const ip = c.req.header("cf-connecting-ip") ?? ""
      // TODO: TEMPORARY - Using hardcoded key for testing
      const key = "test-key-hardcoded"
      console.log("[DEBUG] Rate limit key - IP:", ip, "Using:", key)
      return key
    },
  }),
)
/**
 * GET /v1/merchant/:id/config
 * Returns the subscriptionOwnerAddress given an account address
 * NO AUTH REQUIRED - Public endpoint for MVP
 */
merchantRoutes.get("/:id/config", async (ctx) => {
  const address = ctx.req.param("id")

  // Validate address format
  if (!address || !isAddress(address)) {
    throw new HTTPError(
      400,
      ErrorCode.INVALID_REQUEST,
      "Invalid address format",
    )
  }

  const accountRepo = new AccountRepository(ctx.env)
  const account = await accountRepo.getAccountByAddress(getAddress(address))

  // Always return 200 to prevent enumeration
  // If account doesn't exist or has no subscriptionOwnerAddress,
  // return a deterministic fake address (hash of input address)
  const subscriptionOwnerAddress =
    account?.subscriptionOwnerAddress ||
    (`0x${keccak256(toHex(address)).slice(2, 42)}` as Address)

  return ctx.json({ subscriptionOwnerAddress })
})

/**
 * POST /v1/merchant/:id/subscription
 * Register subscription for a given accountAddress
 * NO AUTH REQUIRED - Public endpoint for MVP
 */
merchantRoutes.post("/:id/subscription", async (ctx) => {
  const accountAddress = ctx.req.param("id")
  const body = await ctx.req.json()
  const { hash, testnet = false, provider = Provider.BASE } = body

  // 1. Validate inputs
  if (!accountAddress || !isAddress(accountAddress)) {
    throw new HTTPError(
      400,
      ErrorCode.INVALID_REQUEST,
      "Invalid account address",
    )
  }

  if (!hash) {
    throw new HTTPError(
      400,
      ErrorCode.INVALID_REQUEST,
      "Missing subscription hash",
    )
  }

  const accountRepo = new AccountRepository(ctx.env)
  const onchainRepo = new OnchainRepository(ctx.env)
  const subscriptionService = new SubscriptionService(ctx.env)
  const webhookService = new WebhookService(ctx.env)

  // 2. Check accountAddress exists in DB
  const account = await accountRepo.getAccountByAddress(
    getAddress(accountAddress),
  )

  if (!account || !account.subscriptionOwnerAddress) {
    throw new HTTPError(404, ErrorCode.NOT_FOUND, "Account not found")
  }

  // 3. Get onchain subscription status
  const { subscription: onchainSub } = await onchainRepo.getSubscriptionStatus({
    subscriptionId: hash,
    provider,
    accountId: account.id,
    testnet,
  })

  // 4. Verify subscription exists on-chain
  if (!onchainSub.permissionExists) {
    throw new HTTPError(
      404,
      ErrorCode.NOT_FOUND,
      "Subscription not found on-chain",
    )
  }

  // 5. Match ownerAddress to account's subscriptionOwnerAddress
  const onchainOwner = onchainSub.subscriptionOwner
  if (
    getAddress(onchainOwner) !== getAddress(account.subscriptionOwnerAddress)
  ) {
    throw new HTTPError(403, ErrorCode.FORBIDDEN, "Subscription owner mismatch")
  }

  // 7. Register and activate subscription (same as RPC flow)
  const { orderId, orderNumber, subscriptionMetadata } =
    await subscriptionService.createSubscription({
      subscriptionId: hash,
      accountId: account.id,
      beneficiaryAddress: account.address, // Merchant's embedded wallet
      provider,
      testnet,
    })

  // Background processing (webhook + activation)
  ctx.executionCtx.waitUntil(
    (async () => {
      try {
        await webhookService.emitSubscriptionCreated({
          accountId: account.id,
          subscriptionId: hash,
          amount: subscriptionMetadata.amount,
          periodInSeconds: subscriptionMetadata.periodInSeconds,
          testnet,
        })

        const activation = await subscriptionService.processActivationCharge({
          subscriptionId: hash,
          accountId: account.id,
          beneficiaryAddress: account.address,
          provider,
          testnet,
          orderId,
          orderNumber,
        })

        await subscriptionService.completeActivation(activation)
        await webhookService.emitSubscriptionActivated(activation)
      } catch (error) {
        await subscriptionService.markSubscriptionIncomplete({
          subscriptionId: hash,
          orderId,
          reason: error instanceof Error ? error.message : "activation_failed",
        })
        await webhookService.emitActivationFailed({
          accountId: account.id,
          subscriptionId: hash,
          amount: subscriptionMetadata.amount,
          periodInSeconds: subscriptionMetadata.periodInSeconds,
          testnet,
          error,
        })
      }
    })(),
  )

  return ctx.json({ status: "processing" }, 201)
})
