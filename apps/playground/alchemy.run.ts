import path from "node:path"
import alchemy from "alchemy"
import { DurableObjectNamespace, Vite } from "alchemy/cloudflare"
import { GitHubComment } from "alchemy/github"
import { CloudflareStateStore } from "alchemy/state"
import { api, app as backendApp, spenderSmartAccount } from "backend/alchemy"
import { resolveStageConfig } from "@/constants/env.constants"
import type { Store } from "@/store/do.store"

// import { Stage } from "backend/constants"

// =============================================================================
// CONFIGURATION & CONVENTIONS
// =============================================================================

/**
 * Resource Naming Convention: {app.name}-{scope.name}-{scope.stage}-{resource}
 * Example: couch-frontend-dev-example-site
 *
 * Components:
 *   app.name:    Product identifier (e.g., "couch-playground")
 *   app.stage:   Environment (e.g., "dev", "staging", "prod")
 *   resource:    Specific resource name (e.g., "subscription-api", "spender-evm")
 */

/**
 * Port Allocation Convention (Development):
 *   3xxx = All backend infrastructure together
 *   8xxx = All user-facing web apps together
 *   9xxx = Third-party/external tools separate
 *
 *   8000-8099: Web Applications (Frontend)
 */

// =============================================================================
// APPLICATION SCOPE
// =============================================================================

export const app = await alchemy("couch-playground", {
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: (scope) => new CloudflareStateStore(scope),
})
const NAME_PREFIX = `${app.name}-${app.stage}`

// Cloudflare Worker Flags
const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

// -----------------------------------------------------------------------------
// Web App
// -----------------------------------------------------------------------------

if (!api.url) throw new Error(`${api.name} didn't expose url`)

const WEBSITE_NAME = "website"
export const website = await Vite(WEBSITE_NAME, {
  name: `${NAME_PREFIX}-${WEBSITE_NAME}`,
  entrypoint: path.join(import.meta.dirname, "src", "api", "main.ts"),
  dev: { env: { VITE_COUCH_SPENDER_ADDRESS: spenderSmartAccount.address } },
  build: { env: { VITE_COUCH_SPENDER_ADDRESS: spenderSmartAccount.address } },
  // Envs exposed to worker only
  bindings: {
    COUCH_WEBHOOK_SECRET: alchemy.secret.env.COUCH_WEBHOOK_SECRET,
    COUCH_API_KEY: alchemy.secret.env.COUCH_API_KEY,
    COUCH_API_URL: api.url,
    STORE: DurableObjectNamespace<Store>("playground-store", {
      className: "Store",
    }),
  },
  compatibilityFlags,
})

if (app.stage === "dev") {
  console.log({ [WEBSITE_NAME]: website })
}

// =============================================================================
// PR PREVIEW COMMENTS
// =============================================================================

if (process.env.PULL_REQUEST) {
  const { NETWORK } = resolveStageConfig(backendApp.stage)

  await GitHubComment("preview-comment", {
    owner: "couchlabs",
    repository: "couch",
    issueNumber: Number(process.env.PULL_REQUEST),
    body: `## 🛋️ Preview Deployed

**Stage:** \`${app.stage}\`
**Network:** ${NETWORK}

👉 **[Playground](${website.url})**
👉 **[Backend API](${api.url})**

---
<sub>🤖 Built from commit ${process.env.GITHUB_SHA?.slice(0, 7)} • This comment updates automatically with each push</sub>`,
  })
}

await app.finalize()
