import path from "node:path"

import alchemy from "alchemy"
import { D1Database, Vite } from "alchemy/cloudflare"
import { api, spenderSmartAccount } from "backend/alchemy"

// import { Stage } from "backend/constants"

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
export const scope = await alchemy("demo", {
  password: process.env.ALCHEMY_PASSWORD,
})
const NAME_PREFIX = `${app.name}-${scope.name}-${scope.stage}`

// -----------------------------------------------------------------------------
// DATABASES
// -----------------------------------------------------------------------------

// subscription-db: Main database for subscription and order data
const DB_NAME = "demo-db"
const db = await D1Database(DB_NAME, {
  name: `${NAME_PREFIX}-${DB_NAME}`,
  migrationsDir: path.join(import.meta.dirname, "migrations"),
  primaryLocationHint: "wnam",
  readReplication: {
    mode: "auto",
  },
})

// -----------------------------------------------------------------------------
// Web App
// -----------------------------------------------------------------------------

const WEBSITE_NAME = "website"
export const website = await Vite(WEBSITE_NAME, {
  name: `${NAME_PREFIX}-${WEBSITE_NAME}`,
  entrypoint: path.join(import.meta.dirname, "src", "api", "main.ts"),
  dev: {
    // Envs to bundle in frontend code.
    // Need to be prefixed with `VITE_` to be included.
    // Can be reach via `import.meta.env`
    env: {
      VITE_COUCH_SPENDER_ADDRESS: spenderSmartAccount.address,
    },
  },
  // Envs exposed to worker only
  bindings: {
    COUCH_WEBHOOK_SECRET: alchemy.secret(process.env.COUCH_WEBHOOK_SECRET),
    COUCH_API_KEY: alchemy.secret(process.env.COUCH_API_KEY),
    COUCH_API_URL: api.url ?? "http://localhost:3000",
    DB: db,
  },
})

console.log({ [WEBSITE_NAME]: website })

await scope.finalize()
