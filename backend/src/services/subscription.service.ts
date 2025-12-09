import type { Address, Hash } from "viem"
import {
  isRevocableStatus,
  OrderStatus,
  OrderType,
} from "@/constants/subscription.constants"
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
import { WebhookService } from "./webhook.service"

// Define the minimal dependencies needed by SubscriptionService
// This service needs all repository deps + ORDER_SCHEDULER for scheduling + WEBHOOK_QUEUE for webhooks
// Pick ORDER_SCHEDULER and WEBHOOK_QUEUE from WorkerEnv to get the exact Alchemy-generated types
export interface SubscriptionServiceDeps
  extends SubscriptionRepositoryDeps,
    OnchainRepositoryDeps,
    Pick<WorkerEnv, "ORDER_SCHEDULER" | "WEBHOOK_QUEUE"> {}

export interface ValidateSubscriptionIdParams {
  subscriptionId: Hash
  provider: Provider
}

export interface CreateSubscriptionParams {
  subscriptionId: Hash
  accountId: number // Who activated subscription (receives webhooks)
  beneficiaryAddress: Address // Who receives payments
  provider: Provider
  testnet: boolean // Network: false = mainnet, true = testnet
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
  accountId: number // Who activated subscription (receives webhooks)
  beneficiaryAddress: Address // Who receives payments
  provider: Provider
  testnet: boolean // Network: false = mainnet, true = testnet
  orderId: number
  orderNumber: number
}

export interface ActivationResult {
  subscriptionId: Hash
  accountId: number // Who activated subscription (receives webhooks)
  provider: Provider
  testnet: boolean // Network where subscription was created
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

export interface ListSubscriptionsParams {
  accountId: number
  testnet?: boolean
}

export interface GetSubscriptionWithOrdersParams {
  subscriptionId: Hash
  accountId: number
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
    const { subscriptionId, provider, transaction, order, nextOrder } = result

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
        provider,
      })

      const scheduler = this.deps.ORDER_SCHEDULER.get(
        this.deps.ORDER_SCHEDULER.idFromName(String(nextOrderId)),
      )

      await scheduler.set({
        orderId: nextOrderId,
        dueAt: new Date(nextOrder.date),
        provider,
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

  /**
   * Lists all subscriptions for an account.
   * Optionally filters by network (testnet vs mainnet).
   */
  async listSubscriptions(params: ListSubscriptionsParams) {
    const { accountId, testnet } = params
    return await this.subscriptionRepository.listSubscriptions({
      accountId,
      testnet,
    })
  }

  /**
   * Gets subscription details with all associated orders.
   * Enforces account ownership - throws 403 if subscription belongs to different account.
   * Returns null if subscription not found.
   */
  async getSubscriptionWithOrders(params: GetSubscriptionWithOrdersParams) {
    const { subscriptionId, accountId } = params

    const subscription = await this.subscriptionRepository.getSubscription({
      subscriptionId,
    })

    if (!subscription) {
      return null
    }

    if (subscription.accountId !== accountId) {
      throw new HTTPError(403, ErrorCode.FORBIDDEN, "Unauthorized", {
        subscriptionId,
      })
    }

    const orders = await this.subscriptionRepository.getSubscriptionOrders({
      subscriptionId,
    })

    return {
      subscription,
      orders,
    }
  }

  /**
   * Revokes a subscription on-chain and updates database.
   * This is an immediate cancellation (not end of period).
   * Handles all validation, onchain checks, and webhook emission.
   */
  async revokeSubscription(params: {
    subscriptionId: Hash
    accountId: number
  }) {
    const { subscriptionId, accountId } = params

    const log = logger.with({ subscriptionId, accountId })

    const subscription = await this.subscriptionRepository.getSubscription({
      subscriptionId,
    })

    if (!subscription) {
      throw new HTTPError(
        404,
        ErrorCode.INVALID_REQUEST,
        "Subscription not found",
        { subscriptionId },
      )
    }

    if (subscription.accountId !== accountId) {
      throw new HTTPError(403, ErrorCode.FORBIDDEN, "Unauthorized", {
        subscriptionId,
      })
    }

    if (subscription.status === "canceled") {
      log.info("Subscription already canceled, returning existing record")
      return subscription
    }

    if (!isRevocableStatus(subscription.status)) {
      throw new HTTPError(
        400,
        ErrorCode.INVALID_REQUEST,
        `Subscription with status '${subscription.status}' cannot be revoked`,
        { subscriptionId },
      )
    }

    const status = await this.onchainRepository.getSubscriptionStatus({
      subscriptionId,
      provider: subscription.provider,
      accountId: subscription.accountId,
      testnet: subscription.testnet,
    })

    if (!status.subscription.permissionExists) {
      throw new HTTPError(
        404,
        ErrorCode.PERMISSION_NOT_FOUND,
        "Subscription permission not found onchain",
        { subscriptionId },
      )
    }

    const onchainSub = status.subscription
    const webhookService = new WebhookService(this.deps)

    if (onchainSub.isSubscribed) {
      log.info("Revoking subscription on-chain")
      await this.onchainRepository.revokeSubscription({
        subscriptionId,
        provider: subscription.provider,
        accountId: subscription.accountId,
        testnet: subscription.testnet,
      })
    } else {
      log.info("Subscription already revoked onchain, skipping revoke")
    }

    // Cancel any pending orders and get their IDs for DO cleanup
    log.info("Canceling pending orders")
    const canceledOrderIds =
      await this.subscriptionRepository.cancelPendingOrders({
        subscriptionId,
      })

    // Delete DO alarms for canceled orders
    if (canceledOrderIds.length > 0) {
      log.info("Deleting DO alarms for canceled orders", {
        orderIds: canceledOrderIds,
      })
      await Promise.all(
        canceledOrderIds.map(async (orderId) => {
          const scheduler = this.deps.ORDER_SCHEDULER.get(
            this.deps.ORDER_SCHEDULER.idFromName(String(orderId)),
          )
          await scheduler.delete()
        }),
      )
    }

    log.info("Updating subscription status in database")
    const canceledSubscription =
      await this.subscriptionRepository.cancelSubscription({
        subscriptionId,
      })

    await webhookService.emitSubscriptionCanceled({
      accountId: subscription.accountId,
      subscriptionId,
      amount: onchainSub.recurringCharge,
      periodInSeconds: onchainSub.periodInSeconds,
      testnet: subscription.testnet,
    })

    log.info("Subscription revoked successfully")
    return canceledSubscription
  }

  async validateId(params: ValidateSubscriptionIdParams): Promise<void> {
    const { subscriptionId, provider } = params

    // Use provider-specific validation
    const isValid = await this.onchainRepository.validateSubscriptionId({
      subscriptionId,
      provider,
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
    const { subscriptionId, accountId, beneficiaryAddress, provider, testnet } =
      params

    // Validate domain constraints
    await this.validateId({ subscriptionId, provider })

    const log = logger.with({ subscriptionId, testnet })

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
        provider,
        accountId,
        testnet,
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
        accountId,
        beneficiaryAddress,
        provider,
        testnet,
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
    const {
      subscriptionId,
      accountId,
      beneficiaryAddress,
      provider,
      testnet,
      orderId,
      orderNumber,
    } = params

    const log = logger.with({ subscriptionId, testnet })

    // Get onchain subscription status again (for charge details)
    const { subscription } = await this.onchainRepository.getSubscriptionStatus(
      {
        subscriptionId,
        provider,
        accountId,
        testnet,
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

    // Check for existing successful transaction on order (idempotency)
    const order = await this.subscriptionRepository.getOrderById({
      orderId,
    })

    let transaction: ChargeResult
    if (order?.transactionHash) {
      log.info("Found existing successful transaction, skipping charge", {
        transactionHash: order.transactionHash,
      })
      transaction = {
        transactionHash: order.transactionHash,
        gasUsed: undefined,
      }
    } else {
      // Execute charge - send payment to beneficiary
      log.info("Processing charge", {
        amount: subscription.remainingChargeInPeriod,
        recipient: beneficiaryAddress,
      })

      transaction = await this.onchainRepository.chargeSubscription({
        subscriptionId,
        amount: subscription.remainingChargeInPeriod,
        recipient: beneficiaryAddress,
        provider,
        accountId,
        testnet,
      })
    }

    log.info("Charge successful", {
      transactionHash: transaction.transactionHash,
      amount: subscription.remainingChargeInPeriod,
    })

    return {
      subscriptionId,
      accountId,
      provider,
      testnet,
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
