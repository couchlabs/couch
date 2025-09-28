import alchemy from "alchemy"
import { Vite } from "alchemy/cloudflare"
import { spenderSmartAccount } from "backend/alchemy"
import { Stage } from "backend/constants"

// =============================================================================
// CONFIGURATION & CONVENTIONS
// =============================================================================

/**
 * Resource Naming Convention: {app.name}-{scope.name}-{scope.stage}-{resource}
 * Example: couch-frontend-dev-example-site
 *
 * Components:
 *   app.name:    Product/organization identifier (e.g., "couch")
 *   scope.name:  Service/component name (e.g., "backend", "frontend")
 *   scope.stage: Environment (e.g., "dev", "staging", "prod")
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

const app = { name: "couch" }
export const scope = await alchemy("frontend", {
  stage: Stage.DEV,
  password: process.env.ALCHEMY_PASSWORD,
})
const NAME_PREFIX = `${app.name}-${scope.name}-${scope.stage}`

// =============================================================================
// Web App
// =============================================================================

const WEBSITE_NAME = "demo"
export const website = await Vite(WEBSITE_NAME, {
  name: `${NAME_PREFIX}-${WEBSITE_NAME}`,
  dev: {
    command: "bun run vite dev", // this should be optional https://github.com/sam-goodwin/alchemy/pull/1014
    env: {
      VITE_SPENDER_ADDRESS: spenderSmartAccount.address,
    },
  },
  build: {
    command: "bun run vite build", // this should be optional https://github.com/sam-goodwin/alchemy/pull/1014
    env: {
      VITE_SPENDER_ADDRESS: spenderSmartAccount.address,
    },
  },
})

console.log({ [WEBSITE_NAME]: website })

await scope.finalize()
