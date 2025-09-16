import path from "node:path"

import alchemy from "alchemy"
import { Worker } from "alchemy/cloudflare"

const app = await alchemy("backend", {
  stage: "dev",
  password: process.env.ALCHEMY_PASSWORD,
})

// TODO
// - Add Hono to current worker ie: /examples/cloudflare-vite/src/index.ts
// - Add D1 provider, need to be binded to both worker (hono) and workflow
// - Add Workflow

export const backend = await Worker("worker", {
  name: `${app.name}-${app.stage}-backend`,
  // 1. ✅ Add Hono to worker
  // Convert existing worker *index.ts) to use Hono as per alchemy/templates/hono/src/index.ts
  entrypoint: path.join(import.meta.dirname, "src", "index.ts"),
  bindings: {
    CDP_API_KEY_ID: alchemy.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: alchemy.secret.env.CDP_API_KEY_SECRET,
    CDP_WALLET_SECRET: alchemy.secret.env.CDP_WALLET_SECRET,
    CDP_ACCOUNT_OWNER_NAME: alchemy.env.CDP_ACCOUNT_OWNER_NAME,
    CDP_SMART_ACCOUNT_NAME: alchemy.env.CDP_SMART_ACCOUNT_NAME,
    // 2. ✅ Add D1
    // https://alchemy.run/providers/cloudflare/d1-database/#bind-to-a-worker

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
