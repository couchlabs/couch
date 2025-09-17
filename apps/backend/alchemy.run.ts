import path from "node:path"

import alchemy from "alchemy"
import { Worker, D1Database, Workflow } from "alchemy/cloudflare"

const app = await alchemy("backend", {
  stage: "dev",
  password: process.env.ALCHEMY_PASSWORD,
})

export const backend = await Worker("subscription-api", {
  name: `${app.name}-${app.stage}-subscription-api`,
  entrypoint: path.join(import.meta.dirname, "src", "subscription-api.ts"),
  bindings: {
    // ENV & SECRETS:
    CDP_API_KEY_ID: alchemy.secret.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_ACCOUNT_OWNER_NAME: alchemy.env.CDP_ACCOUNT_OWNER_NAME,
    CDP_SMART_ACCOUNT_NAME: alchemy.env.CDP_SMART_ACCOUNT_NAME,
    // RESOURCES:
    SUBSCRIPTIONS: await D1Database("subscriptions", {
      name: `${app.name}-${app.stage}-subscriptions`,
      migrationsDir: path.join(import.meta.dirname, "migrations"),
      primaryLocationHint: "wnam",
      readReplication: {
        mode: "auto",
      },
      adopt: true,
    }),
    SUBSCRIPTION_BILLING: Workflow("subscription-billing", {
      workflowName: "subscription-billing",
      className: "SubscriptionBilling",
    }),
  },
  compatibilityFlags: ["nodejs_compat"],
  dev: {
    port: 3000,
  },
})

console.log({ ...backend })

await app.finalize()
