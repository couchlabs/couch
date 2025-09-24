export enum Stage {
  DEV = "dev",
  STAGING = "staging",
  SANDBOX = "sandbox",
  PROD = "prod",
}

export enum Network {
  BASE = "base",
  BASE_SEPOLIA = "base-sepolia",
}

// Helper to determine if we're in a testnet environment (ie: transacting on testnet)
export function isTestnetEnvironment(stage: Stage): boolean {
  return stage !== Stage.PROD
}

// Helper to get the network based on environment
export function getNetwork(testnet: boolean): Network {
  return testnet ? Network.BASE_SEPOLIA : Network.BASE
}
