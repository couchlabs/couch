import * as fs from "node:fs"
import path from "node:path"

import { resolveStageConfig } from "@backend/constants/env.constants"
import type { Provider } from "@backend/providers/provider.interface"
import type { RPC } from "@backend/rpc/main"
import type { OrderScheduler } from "@backend/schedulers/order.scheduler"
import alchemy, { type } from "alchemy"
import {
  D1Database,
  DurableObjectNamespace,
  Queue,
  Ruleset,
  Vite,
  Worker,
} from "alchemy/cloudflare"
import { GitHubComment } from "alchemy/github"
import { CloudflareStateStore, FileSystemStateStore } from "alchemy/state"
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

export const app = await alchemy("couch-platform", {
  password: alchemy.env.ALCHEMY_PASSWORD,
  stateStore: (scope) =>
    scope.local
      ? new FileSystemStateStore(scope)
      : new CloudflareStateStore(scope),
})
const NAME_PREFIX = `${app.name}-${app.stage}`
const { LOGGING, DUNNING_MODE, GH_ENVIRONMENT, PUBLIC_APP_NAME } =
  resolveStageConfig(app.stage)

const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

// -----------------------------------------------------------------------------
// DOMAINS &  WAF/Rules
// -----------------------------------------------------------------------------

const domains: {
  website?: string[]
  api?: string[]
} = {}
if (GH_ENVIRONMENT === "staging") {
  const domain = "staging.cou.ch"
  domains.api = [`api.${domain}`]
  domains.website = [`app.${domain}`]
}
if (GH_ENVIRONMENT === "prod") {
  const domain = "cou.ch"
  domains.api = [`api.${domain}`]
  domains.website = [`app.${domain}`]
}

const WAF_RULE_NAME = "api-protection"
const wafRuleSet = await Ruleset(WAF_RULE_NAME, {
  zone: "cou.ch",
  phase: "http_request_firewall_custom",
  name: "API Protection for couch-platform-app",
  description: "Block non-browser requests to couch-platform-app API endpoints",
  rules: [
    {
      description:
        "Block non-browser requests to couch-platform-app API endpoints",
      expression: `(
        starts_with(http.request.uri.path, "/api/")
        and not http.request.headers["sec-fetch-site"][0] eq "same-origin"
      )`,
      action: "block",
    },
  ],
})

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
  entrypoint: path.join(
    import.meta.dirname,
    "backend",
    "src",
    "api",
    "main.ts",
  ),
  bindings: {
    // ENV & SECRETS:
    CDP_PROJECT_ID: alchemy.env.CDP_PROJECT_ID,
    CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_CLIENT_API_KEY: alchemy.env.CDP_CLIENT_API_KEY,
    // STAGE CONFIGS:
    LOGGING,
    DUNNING_MODE,
    // RESOURCES:
    DB: db,
    ORDER_QUEUE: orderQueue,
    WEBHOOK_QUEUE: webhookQueue,
    ORDER_SCHEDULER: DurableObjectNamespace<OrderScheduler>("order-scheduler", {
      className: "OrderScheduler",
    }),
  },
  compatibilityFlags,
  dev: { port: 3000 },
  url: GH_ENVIRONMENT === "dev",
  domains: domains.api,
})

// -----------------------------------------------------------------------------
// INTERNAL RPC SERVICE
// -----------------------------------------------------------------------------

// rpc: Internal RPC service
const RPC_NAME = "rpc"
export const rpc = await Worker(RPC_NAME, {
  name: `${NAME_PREFIX}-${RPC_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "backend",
    "src",
    "rpc",
    "main.ts",
  ),
  rpc: type<RPC>,
  // Pass API worker binding to inherit its entire environment
  // RPC is an internal API proxy - should have identical bindings to API
  bindings: api.bindings,
  compatibilityFlags,
  dev: { port: 3001 },
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
    "backend",
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
    "backend",
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
    "backend",
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
    "backend",
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

// -----------------------------------------------------------------------------
// Merchant App
// -----------------------------------------------------------------------------

const WEBSITE_NAME = "app"
export const website = await Vite(WEBSITE_NAME, {
  name: `${NAME_PREFIX}-${WEBSITE_NAME}`,
  entrypoint: path.join(import.meta.dirname, "app", "src", "api", "main.ts"),
  assets: {
    directory: path.join(import.meta.dirname, "app", "dist", "client"),
  },
  // Envs exposed to vite build
  dev: {
    env: {
      VITE_COUCH_PUBLIC_APP_NAME: PUBLIC_APP_NAME,
      VITE_CDP_PROJECT_ID: alchemy.env.CDP_PROJECT_ID,
    },
  },
  build: {
    env: {
      VITE_COUCH_PUBLIC_APP_NAME: PUBLIC_APP_NAME,
      VITE_CDP_PROJECT_ID: alchemy.env.CDP_PROJECT_ID,
    },
  },
  // Envs exposed to worker only
  bindings: {
    COUCH_BACKEND_RPC: rpc,
  },
  compatibilityFlags,
  url: GH_ENVIRONMENT === "dev", // Generate URLs for dev (previews deployments)
  domains: domains.website,
})

// Log all resources in dev, machine-readable output in other stages
if (app.local) {
  console.log({
    [API_NAME]: api,
    [RPC_NAME]: rpc,
    [DB_NAME]: db,
    [ORDER_QUEUE_NAME]: orderQueue,
    [ORDER_CONSUMER_NAME]: orderConsumer,
    [WEBHOOK_QUEUE_NAME]: webhookQueue,
    [WEBHOOK_CONSUMER_NAME]: webhookConsumer,
    [ORDER_DLQ_NAME]: orderDLQ,
    [ORDER_DLQ_CONSUMER_NAME]: orderDLQConsumer,
    [WEBHOOK_DLQ_NAME]: webhookDLQ,
    [WEBHOOK_DLQ_CONSUMER_NAME]: webhookDLQConsumer,
    [WEBSITE_NAME]: website,
    [WAF_RULE_NAME]: wafRuleSet,
  })
}

// =============================================================================
// CI
// =============================================================================

const appUrl = website.url || `https://${domains.website?.[0]}`
const apiUrl = api.url || `https://${domains.api?.[0]}`

if (process.env.GITHUB_OUTPUT) {
  // Use new GitHub Actions environment file method
  fs.appendFileSync(alchemy.env.GITHUB_OUTPUT, `api_url=${apiUrl}\n`)
  fs.appendFileSync(alchemy.env.GITHUB_OUTPUT, `app_url=${appUrl}\n`)
}

if (process.env.PULL_REQUEST) {
  await GitHubComment("preview-comment", {
    owner: "couchlabs",
    repository: "couch",
    issueNumber: Number(process.env.PULL_REQUEST),
    token: alchemy.secret.env.GITHUB_TOKEN,
    body: `## Ahoy! Preview Deployed

**Stage:** \`${app.stage}\`

🌐 **[Merchant App](${appUrl})**
⚙️ **[Backend API](${apiUrl})**

---
<sub>🏴‍☠️ Built from commit ${process.env.GITHUB_SHA?.slice(0, 7)} • This comment updates automatically with each push</sub>`,
  })
}

await app.finalize()
