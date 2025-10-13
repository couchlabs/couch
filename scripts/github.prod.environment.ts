/**
 * Setup script for creating GitHub "prod" environment and secrets using Alchemy providers.
 *
 * This script provisions:
 * - GitHub environment: "prod" (for production mainnet deployments)
 * - All required secrets for Cloudflare and CDP mainnet deployments
 * - Protection rules requiring approval before deployment
 *
 * Prerequisites:
 * - GITHUB_TOKEN with repo admin scope
 * - All secret values prepared (see required env vars below)
 *
 * Usage:
 *   bun run scripts/github.prod.environment.ts
 *
 * Environment Details:
 * - Used by stage: prod only
 * - Network: Base mainnet
 * - Protection rules: Required reviewers (manual approval required)
 * - Wallet: Dedicated production mainnet wallet
 * - Behavior: Production configuration (minimal logging, standard dunning)
 *
 * ⚠️  WARNING: This sets up PRODUCTION environment with MAINNET credentials
 */

import alchemy from "alchemy"
import { RepositoryEnvironment } from "alchemy/github"
import {
  createGitHubSecrets,
  GitHubEnvironment,
  owner,
  printSummary,
  repository,
  validateSecrets,
} from "./github.utils"

// =============================================================================
// CONFIGURATION
// =============================================================================

const ENV_NAME = GitHubEnvironment.PROD

console.log(
  "⚠️  WARNING: Setting up PRODUCTION environment with MAINNET credentials\n",
)

const SECRETS = validateSecrets([
  // Alchemy
  {
    name: "ALCHEMY_PASSWORD",
    envVar: "PROD_ALCHEMY_PASSWORD",
    description: "Alchemy deployment password (production)",
  },
  // Cloudflare
  {
    name: "CLOUDFLARE_API_TOKEN",
    description: "Cloudflare API token with Workers deploy permission",
  },
  { name: "CLOUDFLARE_ACCOUNT_ID", description: "Cloudflare account ID" },
  // Coinbase
  {
    name: "CDP_API_KEY_ID",
    envVar: "PROD_CDP_API_KEY_ID",
    description: "CDP API Key ID for mainnet (production)",
  },
  {
    name: "CDP_API_KEY_SECRET",
    envVar: "PROD_CDP_API_KEY_SECRET",
    description: "CDP API Key Secret for mainnet (production)",
  },
  {
    name: "CDP_WALLET_SECRET",
    description: "CDP Wallet Secret (shared across all environments)",
  },
  {
    name: "CDP_CLIENT_API_KEY",
    description:
      "CDP Client API Key for paymaster (shared across all environments)",
  },
])

// =============================================================================
// SETUP
// =============================================================================

// Initialize Alchemy scope for GitHub environment setup
const app = await alchemy(`couch-backend-github-environment`, {
  password: process.env.PROD_ALCHEMY_PASSWORD,
  stage: ENV_NAME,
})

const prodEnv = await RepositoryEnvironment(`${ENV_NAME}-environment`, {
  owner,
  repository,
  name: ENV_NAME,
  // Protection rules - requires approval for deployment
  waitTimer: 0, // No wait timer (approval only)
  preventSelfReview: false, // Allow self-approval (solo developer)
  reviewers: {
    users: ["nickbalestra"],
  },
  // TODO: Add branch protection when setting up staging CD
  // deploymentBranchPolicy: {
  //   protectedBranches: true,
  //   customBranchPolicies: false,
  // },
})

await createGitHubSecrets(prodEnv, SECRETS)

// Finalize Alchemy scope
await app.finalize()

// =============================================================================
// SUMMARY
// =============================================================================

printSummary(prodEnv, {
  stage: "prod",
  network: "Base mainnet",
  protection: "Required approval from @nickbalestra",
  secretCount: SECRETS.length,
  secrets: SECRETS,
  nextSteps: [
    "Test production deployment workflow (dry-run recommended)",
    "Verify minimal logging and standard dunning intervals",
    "Double-check mainnet wallet configuration before first deployment",
    "Check protection rules: https://github.com/couchlabs/couch/settings/environments",
  ],
})
