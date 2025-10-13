export enum Stage {
  DEV = "dev",
  STAGING = "staging",
  SANDBOX = "sandbox",
  PROD = "prod",
}

/**
 * Runtime configuration flags passed via worker bindings
 * These are the single source of truth for environment behavior
 */
export type Network = "testnet" | "mainnet"
export type LoggingLevel = "verbose" | "minimal"
export type DunningMode = "fast" | "standard"
export type WalletStage = "dev" | "sandbox" | "prod"

export interface StageConfig {
  NETWORK: Network
  LOGGING: LoggingLevel
  DUNNING_MODE: DunningMode
  HTTP_TRIGGER: "true" | "false"
  WALLET_STAGE: WalletStage
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

  // Network: Only prod uses mainnet
  const NETWORK: Network = stage === Stage.PROD ? "mainnet" : "testnet"

  // Logging: Minimal for sandbox/prod, verbose for others
  const LOGGING: LoggingLevel =
    stage === Stage.SANDBOX || stage === Stage.PROD ? "minimal" : "verbose"

  // Dunning: Fast intervals ONLY for dev/preview (quick testing)
  const DUNNING_MODE: DunningMode =
    stage === Stage.DEV || isPreview ? "fast" : "standard"

  // HTTP trigger: Allow manual scheduler triggering in dev/preview for testing
  const HTTP_TRIGGER = stage === Stage.DEV || isPreview ? "true" : "false"

  // Wallet: Maps to GitHub environment (3 dedicated wallets)
  const WALLET_STAGE: WalletStage =
    stage === Stage.PROD
      ? "prod" // Mainnet wallet
      : stage === Stage.SANDBOX
        ? "sandbox" // Dedicated sandbox testnet wallet
        : "dev" // Shared dev testnet wallet (dev/staging/pr-*)

  return {
    NETWORK,
    LOGGING,
    DUNNING_MODE,
    HTTP_TRIGGER,
    WALLET_STAGE,
  }
}
