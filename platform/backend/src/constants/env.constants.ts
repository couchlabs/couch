export enum Stage {
  DEV = "dev",
  STAGING = "staging",
  PROD = "prod",
}

/**
 * Runtime configuration flags passed via worker bindings
 * These are the single source of truth for environment behavior
 */
export type LoggingLevel = "verbose" | "minimal"
export type DunningMode = "fast" | "standard"
export type GHEnvironment = "dev" | "staging" | "prod"
export type AppName = "Couch - Dev" | "Couch - Staging" | "Couch"

export interface StageConfig {
  LOGGING: LoggingLevel
  DUNNING_MODE: DunningMode
  GH_ENVIRONMENT: GHEnvironment
  PUBLIC_APP_NAME: AppName
}

/**
 * Resolves stage-specific configuration from deployment stage
 * This mapping is used in alchemy.run.ts to set worker bindings
 *
 * @param stage - The deployment stage (dev, staging, sandbox, prod, or pr-*)
 * @returns Stage configuration with all runtime settings
 */
export function resolveStageConfig(stage: string): StageConfig {
  const isPreview = stage.startsWith("pr-")

  // Validate stage is known
  const knownStages = Object.values(Stage)
  if (!knownStages.includes(stage as Stage) && !isPreview) {
    throw new Error(
      `Unknown stage: ${stage}. Expected one of: ${knownStages.join(", ")} or pr-*`,
    )
  }

  // Logging: Minimal for staging/prod (production-like), verbose for dev/previews
  const LOGGING: LoggingLevel =
    stage === Stage.STAGING || stage === Stage.PROD ? "minimal" : "verbose"

  // Dunning: Fast intervals ONLY for dev/preview (quick testing)
  const DUNNING_MODE: DunningMode =
    stage === Stage.DEV || isPreview ? "fast" : "standard"

  // GitHub Environment: Maps deployment stage to GitHub environment
  const GH_ENVIRONMENT: GHEnvironment =
    stage === Stage.PROD ? "prod" : stage === Stage.STAGING ? "staging" : "dev" // dev/pr-* share dev environment

  // Public App Name to expose to systems
  const PUBLIC_APP_NAME =
    stage === Stage.PROD
      ? "Couch"
      : stage === Stage.STAGING
        ? "Couch - Staging"
        : "Couch - Dev"

  return {
    LOGGING,
    DUNNING_MODE,
    GH_ENVIRONMENT,
    PUBLIC_APP_NAME,
  }
}
