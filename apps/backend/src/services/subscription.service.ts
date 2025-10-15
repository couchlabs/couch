import type { Address, Hash } from "viem"
import { OrderStatus, OrderType } from "@/constants/subscription.constants"
import { ErrorCode, HTTPError } from "@/errors/http.errors"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"
import {
  type ChargeResult,
  OnchainRepository,
  type OnchainRepositoryDeps,
} from "@/repositories/onchain.repository"
import {
  SubscriptionRepository,
  type SubscriptionRepositoryDeps,
} from "@/repositories/subscription.repository"
import type { WorkerEnv } from "@/types/api.env"

// Define the minimal dependencies needed by SubscriptionService
// This service needs all repository deps + ORDER_SCHEDULER for scheduling
// Pick ORDER_SCHEDULER from WorkerEnv to get the exact Alchemy-generated type
export interface SubscriptionServiceDeps
  extends SubscriptionRepositoryDeps,
    OnchainRepositoryDeps,
    Pick<WorkerEnv, "ORDER_SCHEDULER"> {}

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
  accountAddress: Address
  providerId: Provider
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
  private deps: SubscriptionServiceDeps

  constructor(deps: SubscriptionServiceDeps) {
    this.deps = deps
    this.subscriptionRepository = new SubscriptionRepository(deps)
    this.onchainRepository = new OnchainRepository(deps)
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
    const { subscriptionId, providerId, transaction, order, nextOrder } = result

    const log = logger.with({
      subscriptionId,
      transactionHash: transaction.hash,
    })

    try {
      log.info("Completing subscription activation in background")

      const { nextOrderId } =
        await this.subscriptionRepository.executeSubscriptionActivation({
          subscriptionId,
          order,
          transaction,
          nextOrder: {
            dueAt: nextOrder.date,
            amount: nextOrder.amount,
            periodInSeconds: nextOrder.periodInSeconds,
          },
        })

      log.info("Scheduling next order via Durable Object", {
        nextOrderId,
        dueAt: nextOrder.date,
        providerId,
      })

      const scheduler = this.deps.ORDER_SCHEDULER.get(
        this.deps.ORDER_SCHEDULER.idFromName(String(nextOrderId)),
      )

      await scheduler.set({
        orderId: nextOrderId,
        dueAt: new Date(nextOrder.date),
        providerId,
      })

      log.info("Background subscription activation completed", {
        nextOrderId,
        scheduledFor: nextOrder.date,
      })
    } catch (error) {
      // Log but don't throw - this is background processing
      // TODO: A reconciler should handle incomplete activations
      log.error("Background subscription activation failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
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

    // Check if permission exists in indexer
    if (!subscription.permissionExists) {
      throw new HTTPError(
        404,
        ErrorCode.PERMISSION_NOT_FOUND,
        "Subscription permission not found onchain",
        { subscriptionId },
      )
    }

    // Check if subscription is active
    if (!subscription.isSubscribed) {
      throw new HTTPError(
        403,
        ErrorCode.FORBIDDEN,
        "Subscription not active onchain",
        { subscriptionId },
      )
    }

    // Create subscription and initial order in DB
    log.info("Creating subscription and order")
    const result =
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

    if (!result.created) {
      throw new HTTPError(
        409,
        ErrorCode.SUBSCRIPTION_EXISTS,
        "Subscription already exists",
        { subscriptionId },
      )
    }

    return {
      orderId: result.orderId,
      orderNumber: result.orderNumber,
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

    // Validate permission exists
    if (!subscription.permissionExists) {
      throw new HTTPError(
        404,
        ErrorCode.PERMISSION_NOT_FOUND,
        "Subscription permission not found onchain",
        { subscriptionId },
      )
    }

    // Validate nextPeriodStart exists (required for scheduling next charge)
    if (!subscription.nextPeriodStart) {
      logger.error("Missing next period start", { subscriptionId })
      throw new Error(
        "Invalid subscription configuration: missing nextPeriodStart",
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
      providerId,
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
