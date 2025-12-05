import alchemy from "alchemy"
import { Vite } from "alchemy/cloudflare"
import { CloudflareStateStore, FileSystemStateStore } from "alchemy/state"

import { resolveStageConfig } from "@/constants/env.constants"

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

export const app = await alchemy("couch-merchant", {
  password: process.env.ALCHEMY_PASSWORD,
  stateStore: (scope) =>
    scope.local
      ? new FileSystemStateStore(scope)
      : new CloudflareStateStore(scope),
})
const NAME_PREFIX = `${app.name}-${app.stage}`
const { GH_ENVIRONMENT } = resolveStageConfig(app.stage)

const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

let domains: { domainName: string }[] = []
if (GH_ENVIRONMENT === "staging") {
  domains = [{ domainName: "app.staging.cou.ch" }]
}

// -----------------------------------------------------------------------------
// Web App
// -----------------------------------------------------------------------------

const WEBSITE_NAME = "website"
export const website = await Vite(WEBSITE_NAME, {
  name: `${NAME_PREFIX}-${WEBSITE_NAME}`,
  // entrypoint: path.join(import.meta.dirname, "src", "api", "main.ts"),
  // Envs exposed to vite build
  dev: { env: {} },
  build: { env: {} },
  // Envs exposed to worker only
  bindings: {},
  compatibilityFlags,
  url: GH_ENVIRONMENT === "dev", // Generate URLs for dev (previews deployments)
  domains,
})

if (app.local) {
  console.log({ [WEBSITE_NAME]: website })
}
