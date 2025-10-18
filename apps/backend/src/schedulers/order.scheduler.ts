import { DurableObject } from "cloudflare:workers"
import type { AlarmInvocationInfo } from "@cloudflare/workers-types"
import { createLogger } from "@/lib/logger"
import type { Provider } from "@/providers/provider.interface"

const logger = createLogger("order.scheduler")

// Environment interface for OrderScheduler DO
export interface OrderSchedulerEnv {
  ORDER_QUEUE: {
    send: (message: { orderId: number; provider: Provider }) => Promise<void>
  }
}

/**
 * OrderScheduler - DO-based scheduler for orders
 *
 * Responsibilities:
 * 1. Store minimal order metadata (order_id, provider_id)
 * 2. Set alarm for order due time
 * 3. On alarm fire: Send to ORDER_QUEUE (with idempotency)
 * 4. Log operations with structured logger
 *
 * Does NOT:
 * - Store order data (D1 is source of truth)
 * - Process charges (order.consumer.ts handles that)
 * - Make business logic decisions
 *
 * One instance per order, identified by: String(orderId)
 *
 * Key Features:
 * - RPC methods for type-safe calls (no validation needed)
 * - CRUD-style API (set/update/delete/get)
 * - Idempotency flag prevents double-charges
 * - Uses Cloudflare's built-in alarmInfo.retryCount for retry tracking
 * - Retry limits prevent infinite loops
 * - Structured logging for observability
 *
 * Note: This class extends DurableObject to enable RPC support.
 */
export class OrderScheduler extends DurableObject<OrderSchedulerEnv> {
  // Note: This DO needs access to ORDER_QUEUE from env
  // The env parameter provides all bindings from the hosting worker (order-scheduler worker)
  // The scheduler worker has ORDER_QUEUE binding, so this DO can send messages to the queue

  /**
   * Set the schedule for this order (upsert)
   *
   * Creates if doesn't exist, updates if it does.
   * TypeScript provides compile-time type safety via RPC.
   * No runtime validation needed.
   *
   * @param orderId - Required on first call to initialize
   * @param dueAt - When to process the order
   * @param provider - Which blockchain provider
   */
  async set(params: {
    orderId: number
    dueAt: Date
    provider: Provider
  }): Promise<void> {
    const { orderId, dueAt, provider } = params
    const now = new Date()
    const delayMs = dueAt.getTime() - Date.now()
    const log = logger.with({ orderId, provider })
    const op = log.operation("Set schedule")

    op.start({
      dueAt: dueAt.toISOString(),
      delaySeconds: Math.round(delayMs / 1000),
    })

    // Use transaction for atomicity
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put("order_id", orderId)
      await txn.put("provider", provider as string)
      await txn.put("scheduled_at", now.toISOString())
      await txn.put("scheduled_for", dueAt.toISOString())
      await txn.put("alarm_processed", false) // CRITICAL: Idempotency flag
    })

    await this.ctx.storage.setAlarm(dueAt.getTime())

    op.success({
      alarmTime: dueAt.toISOString(),
      delaySeconds: Math.round(delayMs / 1000),
    })
  }

  /**
   * Update the schedule (partial update)
   *
   * Use case: Change due date or provider without recreating schedule
   * orderId is retrieved from storage (set during first .set() call)
   */
  async update(params: { dueAt?: Date; provider?: Provider }): Promise<void> {
    const orderId = await this.ctx.storage.get<number>("order_id")
    const log = logger.with({ orderId })
    const op = log.operation("Update schedule")

    op.start(params)

    if (params.dueAt) {
      const delayMs = params.dueAt.getTime() - Date.now()
      await this.ctx.storage.put("scheduled_for", params.dueAt.toISOString())
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.setAlarm(params.dueAt.getTime())
      log.info("Updated alarm time", {
        newDueAt: params.dueAt.toISOString(),
        delaySeconds: Math.round(delayMs / 1000),
      })
    }

    if (params.provider) {
      await this.ctx.storage.put("provider", params.provider as string)
      log.info("Updated provider", { newProvider: params.provider })
    }

    // Reset processing state for retry
    await this.ctx.storage.put("alarm_processed", false)

    op.success()
  }

  /**
   * Delete the schedule
   *
   * Use case: Subscription canceled, order no longer needed
   */
  async delete(): Promise<void> {
    const orderId = await this.ctx.storage.get<number>("order_id")
    const provider = await this.ctx.storage.get<string>("provider")
    const scheduledFor = await this.ctx.storage.get<string>("scheduled_for")
    const log = logger.with({ orderId, provider })
    const op = log.operation("Delete schedule")

    op.start({
      scheduledFor,
      wasProcessed: await this.ctx.storage.get<boolean>("alarm_processed"),
    })

    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()

    op.success()
  }

  /**
   * Get the schedule status (for debugging)
   *
   * Returns typed object - no JSON parsing needed with RPC
   */
  async get(): Promise<{
    orderId?: number
    provider?: string
    scheduledAt?: string
    scheduledFor?: Date
    processed: boolean
    failed: boolean
  }> {
    const orderId = await this.ctx.storage.get<number>("order_id")
    const provider = await this.ctx.storage.get<string>("provider")
    const scheduledAt = await this.ctx.storage.get<string>("scheduled_at")
    const scheduledFor = await this.ctx.storage.get<string>("scheduled_for")
    const processed = await this.ctx.storage.get<boolean>("alarm_processed")
    const failed = await this.ctx.storage.get<boolean>("failed")

    return {
      orderId,
      provider,
      scheduledAt,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
      processed: processed ?? false,
      failed: failed ?? false,
    }
  }

  /**
   * Alarm handler - fires at scheduled time
   *
   * Cloudflare guarantees:
   * - At-least-once delivery (alarm can fire multiple times)
   * - Automatic retries with exponential backoff (up to 6 attempts)
   * - Provides alarmInfo.retryCount (0 on first attempt)
   *
   * CRITICAL: Idempotency required due to at-least-once semantics.
   *
   * Why idempotency is critical:
   * - If queue.send() succeeds but deleteAll() fails, alarm retries
   * - Without flag: order queued twice → double charge attempt
   * - With flag: second alarm sees processed=true, returns early
   *
   * Timeline example:
   * T=0: Alarm fires (attempt 1, retryCount=0)
   * T=1: Queue.send() succeeds ✓
   * T=2: Put('alarm_processed', true) succeeds ✓
   * T=3: deleteAll() fails ❌
   * T=4: Cloudflare retries alarm (attempt 2, retryCount=1)
   * T=5: Checks 'alarm_processed' = true → Returns early ✓
   * Result: No double charge attempt!
   */
  async alarm(alarmInfo: AlarmInvocationInfo): Promise<void> {
    const orderId = await this.ctx.storage.get<number>("order_id")
    const provider = (await this.ctx.storage.get<string>(
      "provider",
    )) as Provider
    const scheduledFor = await this.ctx.storage.get<string>("scheduled_for")
    const retryCount = alarmInfo.retryCount
    const log = logger.with({ orderId, provider, retryCount })
    const op = log.operation("Process alarm")

    op.start({
      scheduledFor,
      actualTime: new Date().toISOString(),
      isRetry: retryCount > 0,
    })

    if (!orderId || !provider) {
      log.error("Alarm fired but missing order data", {
        hasOrderId: !!orderId,
        hasProvider: !!provider,
      })
      return
    }

    // CRITICAL: Idempotency check (prevents double-charges attempts)
    const processed = await this.ctx.storage.get<boolean>("alarm_processed")
    if (processed) {
      log.info("Already processed, skipping duplicate alarm")
      return
    }

    // Check retry limit (prevents infinite loops)
    // Cloudflare retries up to 6 times, but we cap at 3 for this operation
    if (retryCount >= 3) {
      log.error("Max retry count (3) reached, marking as failed")

      await this.ctx.storage.transaction(async (txn) => {
        await txn.put("alarm_processed", true)
        await txn.put("failed", true)
      })

      // TODO: Alert operations
      // await this.notifyOps({ orderId, error: 'MAX_RETRIES_EXCEEDED' })

      return // Don't throw - prevents further retries
    }

    try {
      log.info("Sending order to queue", { orderId, provider })

      // Send to ORDER_QUEUE
      await this.env.ORDER_QUEUE.send({
        orderId,
        provider,
      })

      log.info("Order queued successfully")

      // CRITICAL: Mark as processed BEFORE cleanup
      // This ensures idempotency even if cleanup fails
      await this.ctx.storage.put("alarm_processed", true)

      log.info("Cleaning up DO storage")

      // Clean up storage (saves space, allows DO eviction)
      await this.ctx.storage.deleteAll()

      op.success({ storageCleared: true })
    } catch (error) {
      op.failure(error)

      log.error("Will retry", {
        willRetry: retryCount < 2,
      })

      // Re-throw to trigger Cloudflare's automatic retry
      throw error
    }
  }
}
