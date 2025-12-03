import * as fs from "node:fs"
import path from "node:path"
import alchemy from "alchemy"
import {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  Queue,
  Worker,
} from "alchemy/cloudflare"
import { CloudflareStateStore, FileSystemStateStore } from "alchemy/state"
import { resolveStageConfig } from "@/constants/env.constants"
import type { Provider } from "@/providers/provider.interface"
import type { OrderScheduler } from "@/schedulers/order.scheduler"
import drizzleConfig from "./drizzle.config"

// =============================================================================
// CONFIGURATION & CONVENTIONS
// =============================================================================

/**
 * Resource Naming Convention: {app.name}-{scope.name}-{scope.stage}-{resource}
 * Example: couch-backend-dev-subscription-api
 *
 * Components:
 *   app.name:    Product identifier (e.g., "couch-backend")
 *   app.stage:   Environment (e.g., "dev", "staging", "prod")
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

export const app = await alchemy("couch-backend", {
  password: alchemy.env.ALCHEMY_PASSWORD,
  stateStore: (scope) =>
    scope.local
      ? new FileSystemStateStore(scope)
      : new CloudflareStateStore(scope),
})
const NAME_PREFIX = `${app.name}-${app.stage}`
const { LOGGING, DUNNING_MODE, GH_ENVIRONMENT } = resolveStageConfig(app.stage)

// =============================================================================
// OFFCHAIN RESOURCES (Cloudflare)
// =============================================================================

// Cloudflare Worker Flags
const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

// Custom Domains
// For dev/previews, domains remains empty (uses couchlabs.workers.dev)
let domains: { domainName: string }[] = []
if (GH_ENVIRONMENT === "staging") {
  domains = [{ domainName: "api.staging.cou.ch" }]
}
if (GH_ENVIRONMENT === "prod") {
  domains = [{ domainName: "api.cou.ch" }]
}

// -----------------------------------------------------------------------------
// DATABASES
// -----------------------------------------------------------------------------

// db: Main database for the backend
const DB_NAME = "db"
const db = await D1Database(DB_NAME, {
  name: `${NAME_PREFIX}-${DB_NAME}`,
  // biome-ignore lint/style/noNonNullAssertion: drizzleConfig.out defined in drizzle.config.ts
  migrationsDir: path.join(import.meta.dirname, drizzleConfig.out!),
  migrationsTable: drizzleConfig.migrations?.table,
  primaryLocationHint: "wnam",
  readReplication: {
    mode: "auto",
  },
})

// allowlist: KV store for authorized account addresses
const ALLOWLIST_NAME = "allowlist"
export const allowlist = await KVNamespace(ALLOWLIST_NAME, {
  title: `${NAME_PREFIX}-${ALLOWLIST_NAME}`,
  values: [
    {
      key: alchemy.env.COUCH_TEST_ACCOUNT_ADDRESS,
      value: "Note: COUCH_TEST_ACCOUNT_ADDRESS",
    },
  ],
})

// -----------------------------------------------------------------------------
// QUEUES
// -----------------------------------------------------------------------------

// order-queue: Queue for processing orders
const ORDER_QUEUE_NAME = "order-queue"
export interface OrderQueueMessage {
  orderId: number
  provider: Provider
}
export const orderQueue = await Queue<OrderQueueMessage>(ORDER_QUEUE_NAME, {
  name: `${NAME_PREFIX}-${ORDER_QUEUE_NAME}`,
  // settings: { ... } // TODO: Add retry/delay settings when needed
})

// webhook-queue: Queue for webhook delivery
const WEBHOOK_QUEUE_NAME = "webhook-queue"
export interface WebhookQueueMessage {
  url: string
  payload: string // Pre-serialized JSON
  signature: string // Pre-computed sha256 HMAC hex
  timestamp: number // Unix timestamp for header
}
export const webhookQueue = await Queue<WebhookQueueMessage>(
  WEBHOOK_QUEUE_NAME,
  {
    name: `${NAME_PREFIX}-${WEBHOOK_QUEUE_NAME}`,
    // settings: { ... } // TODO: Add retry/delay settings when needed
  },
)

// order-dlq: Dead letter queue for permanently failed orders (system errors)
const ORDER_DLQ_NAME = "order-dlq"
export const orderDLQ = await Queue<OrderQueueMessage>(ORDER_DLQ_NAME, {
  name: `${NAME_PREFIX}-${ORDER_DLQ_NAME}`,
})

// webhook-dlq: Dead letter queue for permanently failed webhooks (unreachable endpoints)
const WEBHOOK_DLQ_NAME = "webhook-dlq"
export const webhookDLQ = await Queue<WebhookQueueMessage>(WEBHOOK_DLQ_NAME, {
  name: `${NAME_PREFIX}-${WEBHOOK_DLQ_NAME}`,
})

// -----------------------------------------------------------------------------
// API GATEWAY
// -----------------------------------------------------------------------------

// api: Main API service
const API_NAME = "api"
export const api = await Worker(API_NAME, {
  name: `${NAME_PREFIX}-${API_NAME}`,
  entrypoint: path.join(import.meta.dirname, "src", "api", "main.ts"),
  bindings: {
    // ENV & SECRETS:
    CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_CLIENT_API_KEY: alchemy.env.CDP_CLIENT_API_KEY,
    // STAGE CONFIGS:
    LOGGING,
    DUNNING_MODE,
    // RESOURCES:
    DB: db,
    ALLOWLIST: allowlist,
    ORDER_QUEUE: orderQueue,
    WEBHOOK_QUEUE: webhookQueue,
    ORDER_SCHEDULER: DurableObjectNamespace<OrderScheduler>("order-scheduler", {
      className: "OrderScheduler",
    }),
  },
  compatibilityFlags,
  dev: { port: 3000 },
  url: GH_ENVIRONMENT !== "prod",
  domains,
})

// -----------------------------------------------------------------------------
// QUEUE CONSUMERS
// -----------------------------------------------------------------------------

// order.consumer: Processes orders
const ORDER_CONSUMER_NAME = "order-consumer"
export const orderConsumer = await Worker(ORDER_CONSUMER_NAME, {
  name: `${NAME_PREFIX}-${ORDER_CONSUMER_NAME}`,
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
        maxRetries: 10,
        retryDelay: 60,
        deadLetterQueue: orderDLQ,
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
const WEBHOOK_CONSUMER_NAME = "webhook-consumer"
export const webhookConsumer = await Worker(WEBHOOK_CONSUMER_NAME, {
  name: `${NAME_PREFIX}-${WEBHOOK_CONSUMER_NAME}`,
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
        maxRetries: 10,
        // Exponential backoff implemented in consumer (5s base, 15min cap, ~52min total window)
        deadLetterQueue: webhookDLQ,
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

// -----------------------------------------------------------------------------
// DLQ CONSUMERS
// -----------------------------------------------------------------------------

// order.dlq.consumer: Logs permanently failed orders (system errors)
const ORDER_DLQ_CONSUMER_NAME = "order-dlq-consumer"
export const orderDLQConsumer = await Worker(ORDER_DLQ_CONSUMER_NAME, {
  name: `${NAME_PREFIX}-${ORDER_DLQ_CONSUMER_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "consumers",
    "order.dlq.consumer.ts",
  ),
  eventSources: [
    {
      queue: orderDLQ,
      settings: {
        batchSize: 1,
        maxConcurrency: 1,
        maxRetries: 0,
      },
    },
  ],
  compatibilityFlags,
  dev: { port: 3202 },
})

// webhook.dlq.consumer: Logs permanently failed webhooks (unreachable endpoints)
const WEBHOOK_DLQ_CONSUMER_NAME = "webhook-dlq-consumer"
export const webhookDLQConsumer = await Worker(WEBHOOK_DLQ_CONSUMER_NAME, {
  name: `${NAME_PREFIX}-${WEBHOOK_DLQ_CONSUMER_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "consumers",
    "webhook.dlq.consumer.ts",
  ),
  eventSources: [
    {
      queue: webhookDLQ,
      settings: {
        batchSize: 1,
        maxConcurrency: 1,
        maxRetries: 0,
      },
    },
  ],
  compatibilityFlags,
  dev: { port: 3203 },
})

// Log all resources in dev, machine-readable output in other stages
if (app.local) {
  console.log({
    [API_NAME]: api,
    [DB_NAME]: db,
    [ALLOWLIST_NAME]: allowlist,
    [ORDER_QUEUE_NAME]: orderQueue,
    [ORDER_CONSUMER_NAME]: orderConsumer,
    [WEBHOOK_QUEUE_NAME]: webhookQueue,
    [WEBHOOK_CONSUMER_NAME]: webhookConsumer,
    [ORDER_DLQ_NAME]: orderDLQ,
    [ORDER_DLQ_CONSUMER_NAME]: orderDLQConsumer,
    [WEBHOOK_DLQ_NAME]: webhookDLQ,
    [WEBHOOK_DLQ_CONSUMER_NAME]: webhookDLQConsumer,
  })
}
if (process.env.GITHUB_OUTPUT) {
  // Use new GitHub Actions environment file method
  fs.appendFileSync(
    alchemy.env.GITHUB_OUTPUT,
    `api_url=${api.url || `https://${api?.domains?.[0]?.name}`}\n`,
  )
  fs.appendFileSync(alchemy.env.GITHUB_OUTPUT, `db_name=${db.name}\n`)
}

await app.finalize()

// TODOS
// Reconciler components - see commit ee65232 for commented implementation
// - subscription-reconciler-scheduler:  Audits permission consistency (Worker with cron trigger)
// - subscription-orphan-cache (KV)
// - subscription-revoke-queue: Queue for revocation tasks (Queue)
// - subscription-revoke-consumer:  Revokes cancelled subscriptions (Worker with Queue consumer settings)
