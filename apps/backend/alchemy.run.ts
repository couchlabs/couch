import path from "node:path"

import alchemy from "alchemy"
import { Worker, D1Database, Queue, KVNamespace } from "alchemy/cloudflare"

const app = await alchemy("backend", {
  stage: "dev",
  password: process.env.ALCHEMY_PASSWORD,
})

// ################
// DATABASES
// ################

// subscription-db: Main DB
const DB_NAME = "subscription-db"
const subscriptionDB = await D1Database(DB_NAME, {
  name: `${app.name}-${app.stage}-${DB_NAME}`,
  adopt: true,
  migrationsDir: path.join(import.meta.dirname, "migrations"),
  primaryLocationHint: "wnam",
  readReplication: {
    mode: "auto",
  },
})

// ################
// API GATEWAY
// ################

// subscription-api: Main API service
const API_NAME = "subscription-api"
export const subscriptionAPI = await Worker(API_NAME, {
  name: `${app.name}-${app.stage}-${API_NAME}`,
  entrypoint: path.join(import.meta.dirname, "src", "subscription-api.ts"),
  adopt: true,
  bindings: {
    // ENV & SECRETS:
    CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_WALLET_NAME: alchemy.env.CDP_WALLET_NAME,
    STAGE: app.stage,
    // RESOURCES:
    DB: subscriptionDB,
  },
  compatibilityFlags: ["nodejs_compat"],
  dev: {
    port: 3000,
  },
})

// ################
// QUEUES
// ################

// subscription-charge-queue: Queue for charge tasks
// const CHARGE_QUEUE_NAME = "subscription-charge-queue"
// export const subscriptionChargeQueue = await Queue(CHARGE_QUEUE_NAME, {
//   name: `${app.name}-${app.stage}-${CHARGE_QUEUE_NAME}`,
//   adopt: true,
// })

// subscription-revoke-queue: Queue for revocation tasks
// const REVOKE_QUEUE_NAME = "subscription-revoke-queue"
// export const subscriptionRevokeQueue = await Queue(REVOKE_QUEUE_NAME, {
//   name: `${app.name}-${app.stage}-${REVOKE_QUEUE_NAME}`,
//   adopt: true,
// })

// ################
// SCHEDULERS
// ################

// subscription-charge-scheduler: Schedules recurring charges
// const CHARGE_SCHEDULER_NAME = "subscription-charge-scheduler"
// export const subscriptionChargeScheduler = await Worker(CHARGE_SCHEDULER_NAME, {
//   name: `${app.name}-${app.stage}-${CHARGE_SCHEDULER_NAME}`,
//   entrypoint: path.join(
//     import.meta.dirname,
//     "src",
//     "subscription-charge-scheduler.ts",
//   ),
//   adopt: true,
//   crons: ["*/15 * * * *"], // Run every 15 minutes
//   bindings: {
//     DB: subscriptionDB,
//     CHARGE_QUEUE: subscriptionChargeQueue,
//   },
// })

// subscription-reconciler-scheduler:  Audits permission consistency
// const RECONCILER_SCHEDULER_NAME = "subscription-reconciler-scheduler"
// const KV_ORPHAN_NAME = "subscription-orphan-cache"
// export const subscriptionReconcilerScheduler = await Worker(
//   RECONCILER_SCHEDULER_NAME,
//   {
//     name: `${app.name}-${app.stage}-${RECONCILER_SCHEDULER_NAME}`,
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
//         title: `${app.name}-${app.stage}-${KV_ORPHAN_NAME}`,
//         adopt: true,
//       }),
//       REVOKE_QUEUE: subscriptionRevokeQueue,
//     },
//   },
// )

// ################
// QUEUE CONSUMERS
// ################

// subscription-charge-consumer:  Processes subscription charges
// const CHARGE_CONSUMER_NAME = "subscription-charge-consumer"
// export const subscriptionChargeConsumer = await Worker(CHARGE_CONSUMER_NAME, {
//   name: `${app.name}-${app.stage}-${CHARGE_CONSUMER_NAME}`,
//   entrypoint: path.join(
//     import.meta.dirname,
//     "src",
//     "subscription-charge-consumer.ts",
//   ),
//   adopt: true,
//   eventSources: [
//     {
//       queue: subscriptionChargeQueue,
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

// subscription-revoke-consumer:  Revokes cancelled subscriptions
// const REVOKE_CONSUMER_NAME = "subscription-revoke-consumer"
// export const subscriptionRevokeConsumer = await Worker(REVOKE_CONSUMER_NAME, {
//   name: `${app.name}-${app.stage}-${REVOKE_CONSUMER_NAME}`,
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
  // [CHARGE_SCHEDULER_NAME]: subscriptionChargeScheduler,
  // [RECONCILER_SCHEDULER_NAME]: subscriptionReconcilerScheduler,
  // [CHARGE_QUEUE_NAME]: subscriptionChargeQueue,
  // [REVOKE_QUEUE_NAME]: subscriptionRevokeQueue,
  // [CHARGE_CONSUMER_NAME]: subscriptionChargeConsumer,
  // [REVOKE_CONSUMER_NAME]: subscriptionRevokeConsumer,
})

await app.finalize()
