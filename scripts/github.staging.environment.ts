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
// Note: ALCHEMY_STATE_TOKEN added as repository secret as its shared across environments
// Note: CLOUDFLARE_ACCOUNT_ID added as repository secret as its shared across environments

const SECRETS = validateSecrets([
  // Alchemy
  {
    name: "ALCHEMY_PASSWORD",
    envVar: "STAGING_ALCHEMY_PASSWORD",
    description: "Alchemy deployment password (staging)",
  },
  // Cloudflare
  {
    name: "CLOUDFLARE_API_TOKEN",
    envVar: "STAGING_CLOUDFLARE_API_TOKEN",
    description:
      "Cloudflare API token with Workers deploy permission for staging",
  },
  // Coinbase
  {
    name: "CDP_API_KEY_ID",
    envVar: "STAGING_CDP_API_KEY_ID",
    description: "CDP API Key ID for for staging",
  },
  {
    name: "CDP_API_KEY_SECRET",
    envVar: "STAGING_CDP_API_KEY_SECRET",
    description: "CDP API Key Secret for for staging",
  },
  {
    name: "CDP_WALLET_SECRET",
    envVar: "STAGING_CDP_WALLET_SECRET",
    description: "CDP Wallet Secret for staging",
  },
  {
    name: "CDP_CLIENT_API_KEY",
    envVar: "STAGING_CDP_CLIENT_API_KEY",
    description: "CDP Client API Key for paymaster staging",
  },
  // Couch (Test Account)
  {
    name: "COUCH_TEST_ACCOUNT_ADDRESS",
    envVar: "STAGING_COUCH_TEST_ACCOUNT_ADDRESS",
    description: "Test merchant wallet address (seeded in staging)",
  },
  {
    name: "COUCH_TEST_ACCOUNT_APIKEY",
    envVar: "STAGING_COUCH_TEST_ACCOUNT_APIKEY",
    description: "Test merchant API key (seeded in staging)",
  },
  {
    name: "COUCH_TEST_ACCOUNT_SUBSCRIPTION_OWNER_ADDRESS",
    envVar: "STAGING_COUCH_TEST_ACCOUNT_SUBSCRIPTION_OWNER_ADDRESS",
    description: "Test merchant CDP wallet address (merchant-1, deterministic)",
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
  // No protection rules - automated deployments for dev/preview/staging
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
  protection: "None (auto-deploy)",
  secretCount: SECRETS.length,
  secrets: SECRETS,
  nextSteps: [
    "Test staging deployment workflow",
    "Verify minimal logging and standard dunning intervals",
    "Check protection rules: https://github.com/couchlabs/couch/settings/environments",
  ],
})
