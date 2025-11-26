/**
 * Setup script for creating GitHub "staging" environment and secrets using Alchemy providers.
 *
 * This script provisions:
 * - GitHub environment: "staging" (for staging testnet deployments)
 * - All required secrets for Cloudflare and CDP testnet deployments
 * - Protection rules requiring approval before deployment
 *
 * Prerequisites:
 * - GITHUB_TOKEN with repo admin scope
 * - All secret values prepared (see required env vars below)
 *
 * Usage:
 *   bun run scripts/github.staging.environment.ts
 *
 * Environment Details:
 * - Used by stage: staging only
 * - Network: Base Sepolia (testnet)
 * - Protection rules: Required reviewers (manual approval required)
 * - Wallet: Dedicated staging testnet wallet (separate from dev)
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

const ENV_NAME = GitHubEnvironment.STAGING

const SECRETS = validateSecrets([
  // Alchemy
  {
    name: "ALCHEMY_PASSWORD",
    envVar: "STAGING_ALCHEMY_PASSWORD",
    description: "Alchemy deployment password (staging)",
  },
  {
    name: "ALCHEMY_STATE_TOKEN",
    description: "Alchemy state store token (shared across all environments)",
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
    envVar: "STAGING_CDP_API_KEY_ID",
    description: "CDP API Key ID for testnet (staging)",
  },
  {
    name: "CDP_API_KEY_SECRET",
    envVar: "STAGING_CDP_API_KEY_SECRET",
    description: "CDP API Key Secret for testnet (staging)",
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
  // Couch (Playground)
  {
    name: "MERCHANT_ADDRESS",
    envVar: "STAGING_MERCHANT_ADDRESS",
    description: "Merchant wallet address for creating accounts (staging)",
  },
])

// =============================================================================
// SETUP
// =============================================================================

// Initialize Alchemy scope for GitHub environment setup
const app = await alchemy(`couch-backend-github-environment`, {
  password: process.env.STAGING_ALCHEMY_PASSWORD,
  stage: ENV_NAME,
})

const stagingEnv = await RepositoryEnvironment(`${ENV_NAME}-environment`, {
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

await createGitHubSecrets(stagingEnv, SECRETS)

// Finalize Alchemy scope
await app.finalize()

// =============================================================================
// SUMMARY
// =============================================================================

printSummary(stagingEnv, {
  stage: "staging",
  network: "Base Sepolia (testnet)",
  protection: "Required approval from @nickbalestra",
  secretCount: SECRETS.length,
  secrets: SECRETS,
  nextSteps: [
    "Test staging deployment workflow",
    "Verify minimal logging and standard dunning intervals",
    "Check protection rules: https://github.com/couchlabs/couch/settings/environments",
  ],
})
