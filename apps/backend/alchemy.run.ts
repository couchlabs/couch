import path from "node:path"
import alchemy from "alchemy"
import { D1Database, Queue, Worker } from "alchemy/cloudflare"
import { EvmAccount, EvmSmartAccount } from "alchemy/coinbase"
import type { Stage } from "@/constants/env.constants"
import type { Provider } from "@/providers/provider.interface"
import type { WebhookEvent } from "@/services/webhook.service"
import drizzleConfig from "./drizzle.config"

// =============================================================================
// CONFIGURATION & CONVENTIONS
// =============================================================================

/**
 * Resource Naming Convention: {app.name}-{scope.name}-{scope.stage}-{resource}
 * Example: couch-backend-dev-subscription-api
 *
 * Components:
 *   app.name:    Product/organization identifier (e.g., "couch")
 *   scope.name:  Service/component name (e.g., "backend", "frontend")
 *   scope.stage: Environment (e.g., "dev", "staging", "prod")
 *   resource:    Specific resource name (e.g., "subscription-api", "spender-evm")
 */

/**
 * Port Allocation Convention (Development):
 *   3xxx = All backend infrastructure together
 *   8xxx = All user-facing web apps together
 *   9xxx = Third-party/external tools separate
 *
 *   3000-3099: API Services
 *   3100-3199: Schedulers/Background Workers
 *   3200-3299: Queue Consumers/Workers
 */

// =============================================================================
// APPLICATION SCOPE
// =============================================================================

const app = { name: "couch" }
export const scope = await alchemy("backend", {
  password: process.env.ALCHEMY_PASSWORD,
})
const NAME_PREFIX = `${app.name}-${scope.name}-${scope.stage}`

// =============================================================================
// ONCHAIN RESOURCES (Coinbase)
// =============================================================================

// -----------------------------------------------------------------------------
// EVM Accounts
// -----------------------------------------------------------------------------

/**
 * Server-side smart account for processing subscription charges.
 * Base Account SDK requires EOA and smart account to share the same CDP wallet identifier.
 * @see https://github.com/base-org/account-sdk/blob/main/packages/account-sdk/src/interface/payment/charge.ts#L114-120
 * EvmSmartAccount inherits its name from the owner account when the name property is omitted.
 */
const SPENDER_ACCOUNT_NAME = "spender-evm"
export const spenderSmartAccount = await EvmSmartAccount(SPENDER_ACCOUNT_NAME, {
  owner: await EvmAccount(`${SPENDER_ACCOUNT_NAME}-owner`, {
    name: `${NAME_PREFIX}-${SPENDER_ACCOUNT_NAME}`, // CDP Identifier
  }),
  faucet: {
    "base-sepolia": ["eth"],
  },
})

// =============================================================================
// OFFCHAIN RESOURCES (Cloudflare)
// =============================================================================

// Cloudflare Worker Flags
const compatibilityFlags = ["nodejs_compat"]

// -----------------------------------------------------------------------------
// DATABASES
// -----------------------------------------------------------------------------

// subscription-db: Main database for subscription and order data
const DB_NAME = "db"
const db = await D1Database(DB_NAME, {
  name: `${NAME_PREFIX}-${DB_NAME}`,
  migrationsDir: path.join(import.meta.dirname, drizzleConfig.out),
  migrationsTable: drizzleConfig.migrations?.table,
  primaryLocationHint: "wnam",
  readReplication: {
    mode: "auto",
  },
})

// -----------------------------------------------------------------------------
// QUEUES
// -----------------------------------------------------------------------------

// order-queue: Queue for processing orders
const ORDER_QUEUE_NAME = "order-queue"
export interface OrderQueueMessage {
  orderId: number
  providerId: Provider
}
export const orderQueue = await Queue<OrderQueueMessage>(ORDER_QUEUE_NAME, {
  name: `${NAME_PREFIX}-${ORDER_QUEUE_NAME}`,
  // settings: { ... } // TODO: Add retry/delay settings when needed
})

// webhook-queue: Queue for webhook delivery
const WEBHOOK_QUEUE_NAME = "webhook-queue"
export interface WebhookQueueMessage {
  url: string
  secret: string
  event: WebhookEvent
}
export const webhookQueue = await Queue<WebhookQueueMessage>(
  WEBHOOK_QUEUE_NAME,
  {
    name: `${NAME_PREFIX}-${WEBHOOK_QUEUE_NAME}`,
    // settings: { ... } // TODO: Add retry/delay settings when needed
  },
)

// -----------------------------------------------------------------------------
// API GATEWAY
// -----------------------------------------------------------------------------

// subscription-api: Main API service
const API_NAME = "api"
export const api = await Worker(API_NAME, {
  name: `${NAME_PREFIX}-${API_NAME}`,
  entrypoint: path.join(import.meta.dirname, "src", "api", "main.ts"),
  bindings: {
    // ENV & SECRETS:
    CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_PAYMASTER_URL: alchemy.env.CDP_PAYMASTER_URL,
    CDP_WALLET_NAME: spenderSmartAccount.name,
    CDP_SPENDER_ADDRESS: spenderSmartAccount.address,
    STAGE: scope.stage as Stage,
    // RESOURCES:
    DB: db,
    WEBHOOK_QUEUE: webhookQueue,
  },
  compatibilityFlags,
  dev: { port: 3000 },
})

// -----------------------------------------------------------------------------
// SCHEDULERS
// -----------------------------------------------------------------------------

// order-scheduler: Schedules order processing
const ORDER_SCHEDULER_NAME = "order-scheduler"
export const orderScheduler = await Worker(ORDER_SCHEDULER_NAME, {
  name: `${NAME_PREFIX}-${ORDER_SCHEDULER_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "schedulers",
    "order-scheduler.ts",
  ),
  crons: ["*/15 * * * *"], // Run every 15 minutes
  bindings: {
    DB: db,
    ORDER_QUEUE: orderQueue,
  },
  dev: { port: 3100 },
})

// -----------------------------------------------------------------------------
// QUEUE CONSUMERS
// -----------------------------------------------------------------------------

// order.consumer: Processes orders
const ORDER_PROCESSOR_NAME = "order-processor"
export const orderProcessor = await Worker(ORDER_PROCESSOR_NAME, {
  name: `${NAME_PREFIX}-${ORDER_PROCESSOR_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "consumers",
    "order.consumer.ts",
  ),
  eventSources: [
    {
      queue: orderQueue,
      settings: {
        batchSize: 10,
        maxConcurrency: 10,
        maxRetries: 3,
        // maxWaitTimeMs: 500, Error in miniflare
        retryDelay: 60,
      },
    },
  ],
  bindings: {
    // Consumer requires same bindings as API.
    // Both instantiate repositories and services to process payments (API via HTTP, consumer via queue messages)
    ...api.bindings,
  },
  compatibilityFlags,
  dev: { port: 3200 },
})

// webhook.consumer: Delivers webhooks to merchant endpoints
const WEBHOOK_DELIVERY_NAME = "webhook-delivery"
export const webhookDelivery = await Worker(WEBHOOK_DELIVERY_NAME, {
  name: `${NAME_PREFIX}-${WEBHOOK_DELIVERY_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "consumers",
    "webhook.consumer.ts",
  ),
  eventSources: [
    {
      queue: webhookQueue,
      settings: {
        batchSize: 5,
        maxConcurrency: 5,
        maxRetries: 3,
        retryDelay: 60, // 1 minute
      },
    },
  ],
  bindings: {
    // Webhook delivery only needs DB access
    DB: db,
  },
  compatibilityFlags,
  dev: { port: 3201 },
})

console.log({
  [API_NAME]: api,
  [DB_NAME]: db,
  [ORDER_SCHEDULER_NAME]: orderScheduler,
  [ORDER_QUEUE_NAME]: orderQueue,
  [ORDER_PROCESSOR_NAME]: orderProcessor,
  [WEBHOOK_QUEUE_NAME]: webhookQueue,
  [WEBHOOK_DELIVERY_NAME]: webhookDelivery,
})

await scope.finalize()

// TODOS
// Reconciler components - see commit ee65232 for commented implementation
// - subscription-reconciler-scheduler:  Audits permission consistency (Worker with cron trigger)
// - subscription-orphan-cache (KV)
// - subscription-revoke-queue: Queue for revocation tasks (Queue)
// - subscription-revoke-consumer:  Revokes cancelled subscriptions (Worker with Queue consumer settings)
