import path from "node:path"
import alchemy from "alchemy"
import { Ruleset, Vite } from "alchemy/cloudflare"
import { CloudflareStateStore, FileSystemStateStore } from "alchemy/state"
import { rpc } from "backend/alchemy"
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
const { GH_ENVIRONMENT, PUBLIC_APP_NAME } = resolveStageConfig(app.stage)

const compatibilityFlags = ["nodejs_compat", "disallow_importable_env"]

// -----------------------------------------------------------------------------
// DOMAINS &  WAF/Rules
// -----------------------------------------------------------------------------

let domains: { domainName: string }[] = []
if (GH_ENVIRONMENT === "staging") {
  domains = [{ domainName: "app.staging.cou.ch" }]
} else if (GH_ENVIRONMENT === "prod") {
  domains = [{ domainName: "app.cou.ch" }]
}

const WAF_RULE_NAME = "api-protection"
const wafRuleSet = await Ruleset(WAF_RULE_NAME, {
  zone: "cou.ch",
  phase: "http_request_firewall_custom",
  name: `API Protection for ${NAME_PREFIX}`,
  description: `Block non-browser requests to ${NAME_PREFIX} API endpoints`,
  rules: [
    {
      description: `Block non-browser requests to ${NAME_PREFIX} API endpoints`,
      expression: `(
        starts_with(http.request.uri.path, "/api/")
        and not http.request.headers["sec-fetch-site"][0] eq "same-origin"
      )`,
      action: "block",
    },
  ],
})

// -----------------------------------------------------------------------------
// Web App
// -----------------------------------------------------------------------------

const WEBSITE_NAME = "website"
export const website = await Vite(WEBSITE_NAME, {
  name: `${NAME_PREFIX}-${WEBSITE_NAME}`,
  entrypoint: path.join(import.meta.dirname, "src", "api", "main.ts"),
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
  domains,
})

if (app.local) {
  console.log({
    [WEBSITE_NAME]: website,
    [WAF_RULE_NAME]: wafRuleSet,
  })
}
