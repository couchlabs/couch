import path from "node:path"
import alchemy from "alchemy"
import { D1Database, Queue, Worker } from "alchemy/cloudflare"
import { EvmAccount, EvmSmartAccount } from "alchemy/coinbase"
import { GitHubComment } from "alchemy/github"
import { CloudflareStateStore } from "alchemy/state"
import { resolveStageConfig } from "@/constants/env.constants"
import type { Provider } from "@/providers/provider.interface"
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
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: (scope) => new CloudflareStateStore(scope),
})
const NAME_PREFIX = `${app.name}-${app.stage}`
const { NETWORK, LOGGING, DUNNING_MODE, HTTP_TRIGGER, WALLET_STAGE } =
  resolveStageConfig(app.stage)

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
 *
 * Wallet Strategy (via WALLET_STAGE runtime config):
 * - dev/preview: Share test wallet (couch-backend-dev-spender-evm)
 * - sandbox: Dedicated test wallet (couch-backend-sandbox-spender-evm)
 * - prod: Dedicated mainnet wallet (couch-backend-prod-spender-evm)
 */
const SPENDER_ACCOUNT_NAME = "spender-evm"
export const spenderSmartAccount = await EvmSmartAccount(SPENDER_ACCOUNT_NAME, {
  owner: await EvmAccount(`${SPENDER_ACCOUNT_NAME}-owner`, {
    name: `${app.name}-${WALLET_STAGE}-${SPENDER_ACCOUNT_NAME}`, // CDP Identifier
  }),
  faucet: NETWORK === "testnet" ? { "base-sepolia": ["eth"] } : undefined,
})

// =============================================================================
// OFFCHAIN RESOURCES (Cloudflare)
// =============================================================================

// Cloudflare Worker Flags
const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

// -----------------------------------------------------------------------------
// DATABASES
// -----------------------------------------------------------------------------

// db: Main database for the backend
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
    CDP_WALLET_NAME: spenderSmartAccount.name,
    CDP_SPENDER_ADDRESS: spenderSmartAccount.address,
    // STAGE CONFIGS:
    NETWORK,
    LOGGING,
    DUNNING_MODE,
    WALLET_STAGE,
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

// order.scheduler: Schedules orders
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
    // STAGE CONFIGS:
    LOGGING,
    HTTP_TRIGGER,
  },
  compatibilityFlags,
  dev: { port: 3100 },
})

// dunning.scheduler: Schedules payment retries for past_due subscriptions
const DUNNING_SCHEDULER_NAME = "dunning-scheduler"
export const dunningScheduler = await Worker(DUNNING_SCHEDULER_NAME, {
  name: `${NAME_PREFIX}-${DUNNING_SCHEDULER_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "schedulers",
    "dunning-scheduler.ts",
  ),
  crons: ["0 * * * *"], // Run every hour
  bindings: {
    DB: db,
    ORDER_QUEUE: orderQueue,
    // STAGE CONFIGS:
    LOGGING,
    HTTP_TRIGGER,
  },
  compatibilityFlags,
  dev: { port: 3101 },
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
        maxRetries: 3,
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

// Log all resources in dev, just API URL in other stages
if (app.stage === "dev") {
  console.log({
    [API_NAME]: api,
    [DB_NAME]: db,
    [ORDER_SCHEDULER_NAME]: orderScheduler,
    [DUNNING_SCHEDULER_NAME]: dunningScheduler,
    [ORDER_QUEUE_NAME]: orderQueue,
    [ORDER_CONSUMER_NAME]: orderConsumer,
    [WEBHOOK_QUEUE_NAME]: webhookQueue,
    [WEBHOOK_CONSUMER_NAME]: webhookConsumer,
    [ORDER_DLQ_NAME]: orderDLQ,
    [ORDER_DLQ_CONSUMER_NAME]: orderDLQConsumer,
    [WEBHOOK_DLQ_NAME]: webhookDLQ,
    [WEBHOOK_DLQ_CONSUMER_NAME]: webhookDLQConsumer,
  })
} else {
  console.log(`API URL: ${api.url}`)
}

// =============================================================================
// PR PREVIEW COMMENTS
// =============================================================================

if (process.env.PULL_REQUEST) {
  await GitHubComment("backend-preview-comment", {
    owner: "couchlabs",
    repository: "couch",
    issueNumber: Number(process.env.PULL_REQUEST),
    body: `## 🚀 Backend Preview Deployed

**Stage:** \`${app.stage}\`
**Network:** ${NETWORK === "testnet" ? "Base Sepolia (testnet)" : "Base (mainnet)"}

### 📡 API Endpoints
- **Subscription API:** https://${api.url}
- **Order Scheduler:** https://${orderScheduler.url}
- **Dunning Scheduler:** https://${dunningScheduler.url}

---
<sub>🤖 Built from commit ${process.env.GITHUB_SHA?.slice(0, 7)} • This comment updates automatically with each push</sub>`,
  })
}

await app.finalize()

// TODOS
// Reconciler components - see commit ee65232 for commented implementation
// - subscription-reconciler-scheduler:  Audits permission consistency (Worker with cron trigger)
// - subscription-orphan-cache (KV)
// - subscription-revoke-queue: Queue for revocation tasks (Queue)
// - subscription-revoke-consumer:  Revokes cancelled subscriptions (Worker with Queue consumer settings)
