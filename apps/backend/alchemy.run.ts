import path from "node:path"

import alchemy from "alchemy"
import { Worker, D1Database } from "alchemy/cloudflare"

const app = await alchemy("backend", {
  stage: "dev",
  password: process.env.ALCHEMY_PASSWORD,
})

// TODO
// - Add Workflow

export const backend = await Worker("worker", {
  name: `${app.name}-${app.stage}-worker`,
  entrypoint: path.join(import.meta.dirname, "src", "index.ts"),
  bindings: {
    CDP_API_KEY_ID: alchemy.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_ACCOUNT_OWNER_NAME: alchemy.env.CDP_ACCOUNT_OWNER_NAME,
    CDP_SMART_ACCOUNT_NAME: alchemy.env.CDP_SMART_ACCOUNT_NAME,
    // Resources
    DB: await D1Database("d1", {
      name: `${app.name}-${app.stage}-d1`,
      migrationsDir: path.join(import.meta.dirname, "migrations"),
      primaryLocationHint: "wnam",
      readReplication: {
        mode: "auto",
      },
      adopt: true,
      // To use the real resource from Cloudflare set `dev: {remote: true }`
    }),
    // 3. ✅ Add Workflow
    // https://alchemy.run/providers/cloudflare/workflow/#bind-to-a-worker
  },
  compatibilityFlags: ["nodejs_compat"],
  dev: {
    port: 3000,
  },
})

console.log({ ...backend })

await app.finalize()
