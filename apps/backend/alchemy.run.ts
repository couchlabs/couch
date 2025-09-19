import path from "node:path"

import alchemy from "alchemy"
import { Worker, D1Database, Workflow } from "alchemy/cloudflare"
import type { SubscriptionParams } from "./src/subscription-billing"
import type { SetupParams } from "./src/subscription-setup"

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
    CDP_WALLET_NAME: alchemy.env.CDP_WALLET_NAME,

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
    SUBSCRIPTION_BILLING: Workflow<SubscriptionParams>("subscription-billing", {
      workflowName: "subscription-billing",
      className: "SubscriptionBilling",
    }),
    SUBSCRIPTION_SETUP: Workflow<SetupParams>("subscription-setup", {
      workflowName: "subscription-setup",
      className: "SubscriptionSetup",
    }),
  },
  compatibilityFlags: ["nodejs_compat"],
  dev: {
    port: 3000,
  },
})

console.log({ ...backend })

await app.finalize()
