export enum Stage {
  DEV = "dev",
  STAGING = "staging",
  SANDBOX = "sandbox",
  PROD = "prod",
}

// Helper to determine if we're in a testnet environment (ie: transacting on testnet)
export function isTestnetEnvironment(stage: Stage): boolean {
  return stage !== Stage.PROD
}
