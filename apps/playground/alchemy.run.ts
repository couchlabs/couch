import path from "node:path"
import alchemy from "alchemy"
import { DurableObjectNamespace, Vite } from "alchemy/cloudflare"
import { GitHubComment } from "alchemy/github"
import { CloudflareStateStore, FileSystemStateStore } from "alchemy/state"
import { api, spenderSmartAccount } from "backend/alchemy"
import { resolveStageConfig } from "@/constants/env.constants"
import type { Store } from "@/store/do.store"

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
  stateStore: (scope) =>
    scope.local
      ? new FileSystemStateStore(scope)
      : new CloudflareStateStore(scope),
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
    TEST_COUCH_ACCOUNT_WEBHOOK_SECRET:
      alchemy.secret.env.TEST_COUCH_ACCOUNT_WEBHOOK_SECRET,
    TEST_COUCH_ACCOUNT_APIKEY: alchemy.secret.env.TEST_COUCH_ACCOUNT_APIKEY,
    BACKEND_API: api, // Service binding for RPC-style calls (includes api.url if needed)
    STORE: DurableObjectNamespace<Store>("playground-store", {
      className: "Store",
    }),
  },
  compatibilityFlags,
})

if (app.local) {
  console.log({ [WEBSITE_NAME]: website })
}

// =============================================================================
// PR PREVIEW COMMENTS
// =============================================================================

if (process.env.PULL_REQUEST) {
  const { NETWORK } = resolveStageConfig(app.stage)

  await GitHubComment("preview-comment", {
    owner: "couchlabs",
    repository: "couch",
    issueNumber: Number(process.env.PULL_REQUEST),
    token: alchemy.secret.env.GITHUB_TOKEN,
    body: `## Ahoy! Preview Deployed

**Stage:** \`${app.stage}\`
**Network:** ${NETWORK}

🌐 **[Playground](${website.url})**
⚙️ **[Backend API](${api.url})**

---
<sub>🏴‍☠️ Built from commit ${process.env.GITHUB_SHA?.slice(0, 7)} • This comment updates automatically with each push</sub>`,
  })
}

await app.finalize()
