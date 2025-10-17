/**
 * Setup script for creating GitHub "dev" environment and secrets using Alchemy providers.
 *
 * This script provisions:
 * - GitHub environment: "dev" (for dev, staging, and preview PR deployments)
 * - All required secrets for Cloudflare and CDP testnet deployments
 *
 * Prerequisites:
 * - GITHUB_TOKEN with repo admin scope
 * - All secret values prepared (see required env vars below)
 *
 * Usage:
 *   bun run scripts/github.dev.environment.ts
 *
 * Environment Details:
 * - Used by stages: dev, pr-*, staging
 * - Network: Base Sepolia (testnet)
 * - Protection rules: None (automated deployments)
 * - Wallet: Shared testnet wallet across all dev/preview/staging deployments
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

const ENV_NAME = GitHubEnvironment.DEV
const SECRETS = validateSecrets([
  // Alchemy
  { name: "ALCHEMY_PASSWORD", description: "Alchemy deployment password" },
  {
    name: "ALCHEMY_STATE_TOKEN",
    description: "Alchemy state store token (shared across all deployments)",
  },
  // Cloudflare
  {
    name: "CLOUDFLARE_API_TOKEN",
    description: "Cloudflare API token with Workers deploy permission",
  },
  { name: "CLOUDFLARE_ACCOUNT_ID", description: "Cloudflare account ID" },
  // Coinbase
  { name: "CDP_API_KEY_ID", description: "CDP API Key ID for dev" },
  { name: "CDP_API_KEY_SECRET", description: "CDP API Key Secret for dev" },
  {
    name: "CDP_WALLET_SECRET",
    description: "CDP Wallet Secret (shared across all environments)",
  },
  {
    name: "CDP_CLIENT_API_KEY",
    description:
      "CDP Client API Key for paymaster (shared across all environments)",
  },
  // Couch (Test Account)
  {
    name: "TEST_COUCH_ACCOUNT_ADDRESS",
    description: "Test merchant wallet address (seeded in preview/staging)",
  },
  {
    name: "TEST_COUCH_ACCOUNT_APIKEY",
    description: "Test merchant API key (seeded in preview/staging)",
  },
])

// =============================================================================
// SETUP
// =============================================================================

// Initialize Alchemy scope for GitHub environment setup
const app = await alchemy(`couch-backend-github-environment`, {
  password: process.env.ALCHEMY_PASSWORD,
  stage: ENV_NAME,
})

const devEnv = await RepositoryEnvironment(`${ENV_NAME}-environment`, {
  owner,
  repository,
  name: ENV_NAME,
  // No protection rules - automated deployments for dev/preview/staging
  // Don't set any protection rule properties for unrestricted access
})

await createGitHubSecrets(devEnv, SECRETS)

// Finalize Alchemy scope
await app.finalize()

// =============================================================================
// SUMMARY
// =============================================================================

printSummary(devEnv, {
  stage: "dev, pr-*, staging",
  network: "Base Sepolia (testnet)",
  protection: "None (auto-deploy)",
  secretCount: SECRETS.length,
  secrets: SECRETS,
  nextSteps: [
    "Verify secrets in GitHub: https://github.com/couchlabs/couch/settings/environments",
    "Create sandbox and prod environments if needed",
    "Test preview deployment workflow",
  ],
})
