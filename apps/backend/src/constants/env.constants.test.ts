import { describe, expect, it } from "bun:test"
import { resolveStageConfig, Stage } from "@/constants/env.constants"

describe("resolveStageConfig", () => {
  describe("Dev stage", () => {
    it("returns correct config for dev stage", () => {
      const result = resolveStageConfig(Stage.DEV)

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "fast",
        WALLET_STAGE: "dev",
      })
    })
  })

  describe("Staging stage", () => {
    it("returns correct config for staging stage", () => {
      const result = resolveStageConfig(Stage.STAGING)

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "standard",
        WALLET_STAGE: "dev",
      })
    })
  })

  describe("Sandbox stage", () => {
    it("returns correct config for sandbox stage", () => {
      const result = resolveStageConfig(Stage.SANDBOX)

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "minimal",
        DUNNING_MODE: "standard",
        WALLET_STAGE: "sandbox",
      })
    })
  })

  describe("Prod stage", () => {
    it("returns correct config for prod stage", () => {
      const result = resolveStageConfig(Stage.PROD)

      expect(result).toEqual({
        NETWORK: "mainnet",
        LOGGING: "minimal",
        DUNNING_MODE: "standard",
        WALLET_STAGE: "prod",
      })
    })
  })

  describe("Preview stages (pr-*)", () => {
    it("returns correct config for pr-123", () => {
      const result = resolveStageConfig("pr-123")

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "fast",
        WALLET_STAGE: "dev",
      })
    })

    it("returns correct config for pr-456", () => {
      const result = resolveStageConfig("pr-456")

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "fast",
        WALLET_STAGE: "dev",
      })
    })

    it("returns correct config for pr-feature-branch", () => {
      const result = resolveStageConfig("pr-feature-branch")

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "fast",
        WALLET_STAGE: "dev",
      })
    })
  })

  describe("Unknown stages", () => {
    it("throws error for unknown stage", () => {
      expect(() => resolveStageConfig("unknown")).toThrow(
        "Unknown stage: unknown. Expected one of: dev, staging, sandbox, prod or pr-*",
      )
    })

    it("throws error for typo in stage name", () => {
      expect(() => resolveStageConfig("production")).toThrow(
        "Unknown stage: production. Expected one of: dev, staging, sandbox, prod or pr-*",
      )
    })

    it("throws error for empty string", () => {
      expect(() => resolveStageConfig("")).toThrow(
        "Unknown stage: . Expected one of: dev, staging, sandbox, prod or pr-*",
      )
    })
  })

  describe("Configuration matrix", () => {
    it("dev and preview stages share wallet", () => {
      const devConfig = resolveStageConfig(Stage.DEV)
      const previewConfig = resolveStageConfig("pr-123")

      expect(devConfig.WALLET_STAGE).toBe("dev")
      expect(previewConfig.WALLET_STAGE).toBe("dev")
    })

    it("only prod uses mainnet", () => {
      const stages = [Stage.DEV, Stage.STAGING, Stage.SANDBOX, Stage.PROD]
      const networks = stages.map((stage) => resolveStageConfig(stage).NETWORK)

      expect(networks).toEqual(["testnet", "testnet", "testnet", "mainnet"])
    })

    it("only sandbox and prod use minimal logging", () => {
      const stages = [Stage.DEV, Stage.STAGING, Stage.SANDBOX, Stage.PROD]
      const loggingLevels = stages.map(
        (stage) => resolveStageConfig(stage).LOGGING,
      )

      expect(loggingLevels).toEqual([
        "verbose",
        "verbose",
        "minimal",
        "minimal",
      ])
    })

    it("only dev and preview use fast dunning", () => {
      const devConfig = resolveStageConfig(Stage.DEV)
      const previewConfig = resolveStageConfig("pr-123")
      const stagingConfig = resolveStageConfig(Stage.STAGING)
      const sandboxConfig = resolveStageConfig(Stage.SANDBOX)
      const prodConfig = resolveStageConfig(Stage.PROD)

      expect(devConfig.DUNNING_MODE).toBe("fast")
      expect(previewConfig.DUNNING_MODE).toBe("fast")
      expect(stagingConfig.DUNNING_MODE).toBe("standard")
      expect(sandboxConfig.DUNNING_MODE).toBe("standard")
      expect(prodConfig.DUNNING_MODE).toBe("standard")
    })

    it("each GitHub environment has unique wallet stage", () => {
      const devConfig = resolveStageConfig(Stage.DEV)
      const sandboxConfig = resolveStageConfig(Stage.SANDBOX)
      const prodConfig = resolveStageConfig(Stage.PROD)

      const walletStages = [
        devConfig.WALLET_STAGE,
        sandboxConfig.WALLET_STAGE,
        prodConfig.WALLET_STAGE,
      ]

      // All wallet stages should be unique
      const uniqueWalletStages = new Set(walletStages)
      expect(uniqueWalletStages.size).toBe(3)
      expect(walletStages).toEqual(["dev", "sandbox", "prod"])
    })
  })
})
