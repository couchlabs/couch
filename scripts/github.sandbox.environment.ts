/**
 * Setup script for creating GitHub "sandbox" environment and secrets using Alchemy providers.
 *
 * This script provisions:
 * - GitHub environment: "sandbox" (for sandbox testnet deployments)
 * - All required secrets for Cloudflare and CDP testnet deployments
 * - Protection rules requiring approval before deployment
 *
 * Prerequisites:
 * - GITHUB_TOKEN with repo admin scope
 * - All secret values prepared (see required env vars below)
 *
 * Usage:
 *   bun run scripts/github.sandbox.environment.ts
 *
 * Environment Details:
 * - Used by stage: sandbox only
 * - Network: Base Sepolia (testnet)
 * - Protection rules: Required reviewers (manual approval required)
 * - Wallet: Dedicated sandbox testnet wallet (separate from dev)
 * - Behavior: Identical to prod except network (prod on testnet)
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

const ENV_NAME = GitHubEnvironment.SANDBOX

const SECRETS = validateSecrets([
  // Alchemy
  {
    name: "ALCHEMY_PASSWORD",
    envVar: "SANDBOX_ALCHEMY_PASSWORD",
    description: "Alchemy deployment password (sandbox)",
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
    envVar: "SANDBOX_CDP_API_KEY_ID",
    description: "CDP API Key ID for testnet (sandbox)",
  },
  {
    name: "CDP_API_KEY_SECRET",
    envVar: "SANDBOX_CDP_API_KEY_SECRET",
    description: "CDP API Key Secret for testnet (sandbox)",
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
  password: process.env.SANDBOX_ALCHEMY_PASSWORD,
  stage: ENV_NAME,
})

const sandboxEnv = await RepositoryEnvironment(`${ENV_NAME}-environment`, {
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

await createGitHubSecrets(sandboxEnv, SECRETS)

// Finalize Alchemy scope
await app.finalize()

// =============================================================================
// SUMMARY
// =============================================================================

printSummary(sandboxEnv, {
  stage: "sandbox",
  network: "Base Sepolia (testnet)",
  protection: "Required approval from @nickbalestra",
  secretCount: SECRETS.length,
  secrets: SECRETS,
  nextSteps: [
    "Test sandbox deployment workflow",
    "Verify minimal logging and standard dunning intervals",
    "Check protection rules: https://github.com/couchlabs/couch/settings/environments",
  ],
})
