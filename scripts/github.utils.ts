/**
 * Shared utilities for GitHub environment setup scripts
 */

import { GitHubSecret } from "alchemy/github"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * GitHub environment names
 * Maps to GitHub deployment environments with their protection rules
 */
export enum GitHubEnvironment {
  DEV = "dev",
  STAGING = "staging",
  PROD = "prod",
}

/**
 * GitHub repository configuration
 */
export const owner = "couchlabs"
export const repository = "couch"

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Validates that all required environment variables are set
 * Returns the secrets array for chaining
 * Exits the process with error if any are missing
 */
export function validateSecrets<
  T extends Array<{ name: string; envVar?: string }>,
>(secrets: T): T {
  console.log("🔍 Validating environment variables...\n")

  const missing: string[] = []
  for (const secret of secrets) {
    const envVarName = secret.envVar || secret.name
    if (!process.env[envVarName]) {
      missing.push(envVarName)
    }
  }

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:")
    for (const key of missing) {
      console.error(`   - ${key}`)
    }
    console.error(
      "\nPlease set all required environment variables and try again.",
    )
    console.error(
      "See the environment architecture spec for details on obtaining these values.\n",
    )
    process.exit(1)
  }

  console.log("✅ All required environment variables are set\n")
  return secrets
}

/**
 * Creates GitHub secrets in parallel for an environment
 */
export async function createGitHubSecrets(
  env: { owner: string; repository: string; name: string },
  secrets: Array<{ name: string; envVar?: string; description: string }>,
): Promise<void> {
  console.log("🔐 Setting up secrets...")

  const { default: alchemy } = await import("alchemy")

  await Promise.all(
    secrets.map(async (config) => {
      const envVarName = config.envVar || config.name
      console.log(`   Setting ${config.name}...`)
      await GitHubSecret(
        `${env.name}-${config.name.toLowerCase().replace(/_/g, "-")}`,
        {
          owner: env.owner,
          repository: env.repository,
          environment: env.name,
          name: config.name,
          value: alchemy.secret.env[envVarName],
        },
      )
    }),
  )

  console.log(`\n✅ Set ${secrets.length} secrets\n`)
}

/**
 * Configuration for environment summary output
 */
export interface SummaryConfig {
  stage: string
  network: string
  protection: string
  secretCount: number
  secrets: Array<{ name: string; description: string }>
  nextSteps: string[]
}

/**
 * Prints environment setup summary
 */
export function printSummary(
  env: { owner: string; repository: string; name: string },
  config: SummaryConfig,
): void {
  console.log(
    `🎉 ${env.name.charAt(0).toUpperCase() + env.name.slice(1)} environment setup complete!\n`,
  )
  console.log("📋 Summary:")
  console.log(`   Repository: ${env.owner}/${env.repository}`)
  console.log(`   Environment: ${env.name}`)
  console.log(`   Secrets: ${config.secretCount}`)
  console.log(`   Used by stage: ${config.stage}`)
  console.log(`   Network: ${config.network}`)
  console.log(`   Protection: ${config.protection}\n`)

  console.log("🔐 Secrets configured:")
  for (const secret of config.secrets) {
    console.log(`   ✓ ${secret.name} - ${secret.description}`)
  }

  console.log("\n📝 Next steps:")
  for (let i = 0; i < config.nextSteps.length; i++) {
    console.log(`   ${i + 1}. ${config.nextSteps[i]}`)
  }
  console.log(
    `\n✨ ${env.name.charAt(0).toUpperCase() + env.name.slice(1)} environment ready!\n`,
  )
}
