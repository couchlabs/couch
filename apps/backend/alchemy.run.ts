import path from "node:path"

import alchemy from "alchemy"
import { Worker, D1Database, Queue, KVNamespace } from "alchemy/cloudflare"
import { EvmAccount, EvmSmartAccount } from "alchemy/coinbase"

import { Stage } from "@/lib/constants"
import type { Hash } from "viem"

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
 *   3000-3099: API Services
 *   3100-3199: Schedulers/Background Workers
 *   3200-3299: Queue Consumers/Workers
 *   5000+:     External Services
 */

// =============================================================================
// APPLICATION SCOPE
// =============================================================================

const app = { name: "couch" }
export const scope = await alchemy("backend", {
  stage: Stage.DEV,
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
 * The smart account inherits this from the EOA owner's 'name' field when name is omitted.
 * @see https://github.com/base-org/account-sdk/blob/main/packages/account-sdk/src/interface/payment/charge.ts#L114-120
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

// Cloudflare Worker Compatibility
const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

// -----------------------------------------------------------------------------
// DATABASES
// -----------------------------------------------------------------------------

// subscription-db: Main database for subscription and billing data
const DB_NAME = "subscription-db"
const subscriptionDB = await D1Database(DB_NAME, {
  name: `${NAME_PREFIX}-${DB_NAME}`,
  migrationsDir: path.join(import.meta.dirname, "migrations"),
  primaryLocationHint: "wnam",
  readReplication: {
    mode: "auto",
  },
})

// -----------------------------------------------------------------------------
// API GATEWAY
// -----------------------------------------------------------------------------

// subscription-api: Main API service
const API_NAME = "subscription-api"
export const subscriptionAPI = await Worker(API_NAME, {
  name: `${NAME_PREFIX}-${API_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "api",
    "subscription-api.ts",
  ),
  bindings: {
    // ENV & SECRETS:
    CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_PAYMASTER_URL: alchemy.env.CDP_PAYMASTER_URL,
    CDP_WALLET_NAME: spenderSmartAccount.name,
    CDP_SMART_ACCOUNT_ADDRESS: spenderSmartAccount.address,
    STAGE: scope.stage as Stage,
    // RESOURCES:
    DB: subscriptionDB,
  },
  compatibilityFlags,
  dev: { port: 3000 },
})

// -----------------------------------------------------------------------------
// QUEUES
// -----------------------------------------------------------------------------

// subscription-charge-queue: Queue for charge tasks
const CHARGE_QUEUE_NAME = "subscription-charge-queue"
export interface ChargeQueueMessage {
  billingEntryId: number
  subscriptionId: Hash
  amount: string
  dueAt: string
  attemptNumber: number
}
export const subscriptionChargeQueue = await Queue<ChargeQueueMessage>(
  CHARGE_QUEUE_NAME,
  {
    name: `${NAME_PREFIX}-${CHARGE_QUEUE_NAME}`,
  },
)

// subscription-revoke-queue: Queue for revocation tasks
// const REVOKE_QUEUE_NAME = "subscription-revoke-queue"
// export const subscriptionRevokeQueue = await Queue(REVOKE_QUEUE_NAME, {
//   name: `${scope.name}-${scope.stage}-${REVOKE_QUEUE_NAME}`,
//   adopt: true,
// })

// -----------------------------------------------------------------------------
// SCHEDULERS
// -----------------------------------------------------------------------------

// subscription-charge-scheduler: Schedules recurring charges
const CHARGE_SCHEDULER_NAME = "subscription-charge-scheduler"
export const subscriptionChargeScheduler = await Worker(CHARGE_SCHEDULER_NAME, {
  name: `${NAME_PREFIX}-${CHARGE_SCHEDULER_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "schedulers",
    "subscription-charge-scheduler.ts",
  ),
  crons: ["*/15 * * * *"], // Run every 15 minutes
  bindings: {
    DB: subscriptionDB,
    CHARGE_QUEUE: subscriptionChargeQueue,
  },
  dev: { port: 3100 },
})

// subscription-reconciler-scheduler:  Audits permission consistency
// const RECONCILER_SCHEDULER_NAME = "subscription-reconciler-scheduler"
// const KV_ORPHAN_NAME = "subscription-orphan-cache"
// export const subscriptionReconcilerScheduler = await Worker(
//   RECONCILER_SCHEDULER_NAME,
//   {
//     name: `${scope.name}-${scope.stage}-${RECONCILER_SCHEDULER_NAME}`,
//     entrypoint: path.join(
//       import.meta.dirname,
//       "src",
//       "subscription-reconciler-scheduler.ts",
//     ),
//     adopt: true,
//     crons: ["*/30 * * * *"], // Run every 30 minutes
//     bindings: {
//       // ENV & SECRETS:
//       CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
//       CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
//       // RESOURCES:
//       DB: subscriptionDB,
//       ORPHAN_CACHE: await KVNamespace(KV_ORPHAN_NAME, {
//         title: `${scope.name}-${scope.stage}-${KV_ORPHAN_NAME}`,
//         adopt: true,
//       }),
//       REVOKE_QUEUE: subscriptionRevokeQueue,
//     },
//   },
// )

// -----------------------------------------------------------------------------
// QUEUE CONSUMERS
// -----------------------------------------------------------------------------

// subscription-charge-consumer:  Processes subscription charges
const CHARGE_CONSUMER_NAME = "subscription-charge-consumer"
export const subscriptionChargeConsumer = await Worker(CHARGE_CONSUMER_NAME, {
  name: `${NAME_PREFIX}-${CHARGE_CONSUMER_NAME}`,
  entrypoint: path.join(
    import.meta.dirname,
    "src",
    "consumers",
    "subscription-charge-consumer.ts",
  ),
  eventSources: [
    {
      queue: subscriptionChargeQueue,
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
    ...subscriptionAPI.bindings,
  },
  compatibilityFlags,
  dev: { port: 3200 },
})

// subscription-revoke-consumer:  Revokes cancelled subscriptions
// const REVOKE_CONSUMER_NAME = "subscription-revoke-consumer"
// export const subscriptionRevokeConsumer = await Worker(REVOKE_CONSUMER_NAME, {
//   name: `${scope.name}-${scope.stage}-${REVOKE_CONSUMER_NAME}`,
//   entrypoint: path.join(
//     import.meta.dirname,
//     "src",
//     "subscription-revoke-consumer.ts",
//   ),
//   adopt: true,
//   eventSources: [
//     {
//       queue: subscriptionRevokeQueue,
//       settings: {
//         batchSize: 10,
//         maxConcurrency: 10,
//         maxRetries: 3,
//         maxWaitTimeMs: 5000,
//         retryDelay: 60,
//       },
//     },
//   ],
//   bindings: {
//     // ENV & SECRETS:
//     CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
//     CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
//     CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
//     CDP_WALLET_NAME: alchemy.env.CDP_WALLET_NAME,
//     // RESOURCES:
//     DB: subscriptionDB,
//   },
// })

console.log({
  [API_NAME]: subscriptionAPI,
  [DB_NAME]: subscriptionDB,
  [CHARGE_SCHEDULER_NAME]: subscriptionChargeScheduler,
  [CHARGE_QUEUE_NAME]: subscriptionChargeQueue,
  [CHARGE_CONSUMER_NAME]: subscriptionChargeConsumer,
  // [RECONCILER_SCHEDULER_NAME]: subscriptionReconcilerScheduler,
  // [REVOKE_QUEUE_NAME]: subscriptionRevokeQueue,
  // [REVOKE_CONSUMER_NAME]: subscriptionRevokeConsumer,
})

await scope.finalize()
