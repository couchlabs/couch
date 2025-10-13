import type { D1Database } from "@cloudflare/workers-types"
import type { Address, Hash } from "viem"
import type { LoggingLevel, Network } from "@/constants/env.constants"
import { OrderStatus, OrderType } from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import {
  type ChargeResult,
  OnchainRepository,
} from "@/repositories/onchain.repository"
import { SubscriptionRepository } from "@/repositories/subscription.repository"

export interface SubscriptionServiceDeps {
  // From SubscriptionRepository
  DB: D1Database
  LOGGING: LoggingLevel
  // From OnchainRepository
  CDP_API_KEY_ID: string
  CDP_API_KEY_SECRET: string
  CDP_WALLET_SECRET: string
  CDP_WALLET_NAME: string
  CDP_CLIENT_API_KEY: string
  CDP_SPENDER_ADDRESS: Address
  NETWORK: Network
}

export interface ValidateSubscriptionIdParams {
  subscriptionId: Hash
  providerId: Provider
}

export interface CreateSubscriptionParams {
  subscriptionId: Hash
  accountAddress: Address
  providerId: Provider
}

export interface CreateSubscriptionResult {
  orderId: number
  orderNumber: number
  subscriptionMetadata: {
    amount: string
    periodInSeconds: number
  }
}

export interface ProcessActivationChargeParams {
  subscriptionId: Hash
  accountAddress: Address
  providerId: Provider
  orderId: number
  orderNumber: number
}

export interface ActivationResult {
  subscriptionId: Hash
  accountAddress: Address // Include this in the result
  transaction: {
    hash: Hash
    amount: string
  }
  order: {
    id: number
    number: number // Sequential order number from database
    dueAt: string // ISO datetime
    periodInSeconds: number
  }
  nextOrder: {
    date: string
    amount: string
    periodInSeconds: number
  }
}

const logger = createLogger("subscription.service")

export class SubscriptionService {
  private subscriptionRepository: SubscriptionRepository
  private onchainRepository: OnchainRepository

  constructor(env: SubscriptionServiceDeps) {
    this.subscriptionRepository = new SubscriptionRepository(env)
    this.onchainRepository = new OnchainRepository(env)
  }

  /**
   * Create SubscriptionService with injected dependencies for testing
   * Allows mocking repositories without touching production constructor
   */
  static createForTesting(deps: {
    subscriptionRepository: SubscriptionRepository
    onchainRepository: OnchainRepository
  }): SubscriptionService {
    const service = Object.create(SubscriptionService.prototype)
    service.subscriptionRepository = deps.subscriptionRepository
    service.onchainRepository = deps.onchainRepository
    return service
  }

  /**
   * Completes the subscription activation in the background.
   * This includes database updates and scheduling next order.
   * Errors are logged but not thrown since this runs in background.
   */
  async completeActivation(result: ActivationResult): Promise<void> {
    const log = logger.with({
      subscriptionId: result.subscriptionId,
      transactionHash: result.transaction.hash,
    })

    try {
      log.info("Completing subscription activation in background")

      await this.subscriptionRepository.executeSubscriptionActivation({
        subscriptionId: result.subscriptionId,
        order: result.order,
        transaction: result.transaction,
        nextOrder: {
          dueAt: result.nextOrder.date,
          amount: result.nextOrder.amount,
          periodInSeconds: result.nextOrder.periodInSeconds,
        },
      })

      log.info("Background subscription activation completed")
    } catch (error) {
      // Log but don't throw - this is background processing
      // TODO: A reconciler should handle incomplete activations
      log.error("Background subscription activation failed", error)
    }
  }

  /**
   * Marks a subscription as incomplete after a failed charge.
   * Used in error handling flows.
   */
  async markSubscriptionIncomplete(params: {
    subscriptionId: Hash
    orderId: number
    reason: string
  }): Promise<void> {
    await this.subscriptionRepository.markSubscriptionIncomplete(params)
  }

  async validateId(params: ValidateSubscriptionIdParams): Promise<void> {
    const { subscriptionId, providerId } = params

    // Use provider-specific validation
    const isValid = await this.onchainRepository.validateSubscriptionId({
      subscriptionId,
      providerId,
    })

    if (!isValid) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_FORMAT,
        "Invalid subscription_id format for the specified provider",
      )
    }
  }

  /**
   * Creates a subscription in the database after validating onchain.
   * Returns subscription metadata for webhook emission.
   * Does NOT perform the charge - use processActivationCharge() for that.
   */
  async createSubscription(
    params: CreateSubscriptionParams,
  ): Promise<CreateSubscriptionResult> {
    const { subscriptionId, accountAddress, providerId } = params

    // Validate domain constraints
    await this.validateId({ subscriptionId, providerId })

    const log = logger.with({ subscriptionId })

    // Check if subscription already exists (early exit)
    const exists = await this.subscriptionRepository.subscriptionExists({
      subscriptionId,
    })
    if (exists) {
      throw new HTTPError(
        409,
        ErrorCode.SUBSCRIPTION_EXISTS,
        "Subscription already exists",
        { subscriptionId },
      )
    }

    // Get onchain subscription status and validate
    log.info("Fetching onchain subscription status")
    const { subscription } = await this.onchainRepository.getSubscriptionStatus(
      {
        subscriptionId,
        providerId,
      },
    )

    if (!subscription.isSubscribed) {
      throw new HTTPError(
        403,
        ErrorCode.FORBIDDEN,
        "Subscription not active onchain",
        { subscriptionId },
      )
    }

    // Validate all required fields are present
    if (!subscription.remainingChargeInPeriod) {
      logger.error("Missing remaining charge in period", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing remainingChargeInPeriod",
      )
    }

    if (!subscription.recurringCharge) {
      logger.error("Missing recurring charge", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing recurringCharge",
      )
    }

    if (!subscription.periodInSeconds) {
      logger.error("Missing period in seconds", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing periodInSeconds",
      )
    }

    // Create subscription and initial order in DB
    log.info("Creating subscription and order")
    const { created, orderId, orderNumber } =
      await this.subscriptionRepository.createSubscriptionWithOrder({
        subscriptionId,
        ownerAddress: subscription.subscriptionOwner,
        accountAddress,
        providerId,
        order: {
          subscriptionId: subscriptionId,
          type: OrderType.INITIAL,
          dueAt: new Date().toISOString(),
          amount: String(subscription.remainingChargeInPeriod),
          periodInSeconds: subscription.periodInSeconds,
          status: OrderStatus.PROCESSING,
        },
      })

    if (!created || !orderId || !orderNumber) {
      throw new HTTPError(
        409,
        ErrorCode.SUBSCRIPTION_EXISTS,
        "Subscription already exists",
        { subscriptionId },
      )
    }

    return {
      orderId,
      orderNumber,
      subscriptionMetadata: {
        amount: String(subscription.recurringCharge),
        periodInSeconds: subscription.periodInSeconds,
      },
    }
  }

  /**
   * Processes the activation charge for a subscription.
   * Must be called after createSubscription().
   * Validates onchain, attempts charge, and returns ActivationResult on success.
   */
  async processActivationCharge(
    params: ProcessActivationChargeParams,
  ): Promise<ActivationResult> {
    const { subscriptionId, accountAddress, providerId, orderId, orderNumber } =
      params

    const log = logger.with({ subscriptionId })

    // Get onchain subscription status again (for charge details)
    const { subscription } = await this.onchainRepository.getSubscriptionStatus(
      {
        subscriptionId,
        providerId,
      },
    )

    // Validate required fields are present
    if (!subscription.remainingChargeInPeriod) {
      logger.error("Missing remaining charge in period", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing remainingChargeInPeriod",
      )
    }

    if (!subscription.periodInSeconds) {
      logger.error("Missing period in seconds", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing periodInSeconds",
      )
    }

    if (!subscription.currentPeriodStart) {
      logger.error("Missing current period start", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing currentPeriodStart",
      )
    }

    if (!subscription.nextPeriodStart) {
      logger.error("Missing next period start", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing nextPeriodStart",
      )
    }

    if (!subscription.recurringCharge) {
      logger.error("Missing recurring charge", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing recurringCharge",
      )
    }

    // Check for existing successful transaction (idempotency)
    const existingTransaction =
      await this.subscriptionRepository.getSuccessfulTransaction({
        subscriptionId,
        orderId,
      })

    let transaction: ChargeResult
    if (existingTransaction) {
      log.info("Found existing successful transaction, skipping charge", {
        transactionHash: existingTransaction.transactionHash,
      })
      transaction = {
        transactionHash: existingTransaction.transactionHash,
        gasUsed: undefined,
      }
    } else {
      // Execute charge
      log.info("Processing charge", {
        amount: subscription.remainingChargeInPeriod,
        recipient: accountAddress,
      })

      transaction = await this.onchainRepository.chargeSubscription({
        subscriptionId,
        amount: subscription.remainingChargeInPeriod,
        recipient: accountAddress,
        providerId,
      })
    }

    log.info("Charge successful", {
      transactionHash: transaction.transactionHash,
      amount: subscription.remainingChargeInPeriod,
    })

    return {
      subscriptionId,
      accountAddress,
      transaction: {
        hash: transaction.transactionHash,
        amount: subscription.remainingChargeInPeriod,
      },
      order: {
        id: orderId,
        number: orderNumber,
        dueAt: subscription.currentPeriodStart.toISOString(),
        periodInSeconds: subscription.periodInSeconds,
      },
      nextOrder: {
        date: subscription.nextPeriodStart.toISOString(),
        amount: String(subscription.recurringCharge),
        periodInSeconds: subscription.periodInSeconds,
      },
    }
  }
}
