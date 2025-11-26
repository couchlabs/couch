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
        GH_ENVIRONMENT: "dev",
      })
    })
  })

  describe("Staging stage", () => {
    it("returns correct config for staging stage", () => {
      const result = resolveStageConfig(Stage.STAGING)

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "minimal",
        DUNNING_MODE: "standard",
        GH_ENVIRONMENT: "staging",
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
        GH_ENVIRONMENT: "prod",
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
        GH_ENVIRONMENT: "dev",
      })
    })

    it("returns correct config for pr-456", () => {
      const result = resolveStageConfig("pr-456")

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "fast",
        GH_ENVIRONMENT: "dev",
      })
    })

    it("returns correct config for pr-feature-branch", () => {
      const result = resolveStageConfig("pr-feature-branch")

      expect(result).toEqual({
        NETWORK: "testnet",
        LOGGING: "verbose",
        DUNNING_MODE: "fast",
        GH_ENVIRONMENT: "dev",
      })
    })
  })

  describe("Unknown stages", () => {
    it("throws error for unknown stage", () => {
      expect(() => resolveStageConfig("unknown")).toThrow(
        "Unknown stage: unknown. Expected one of: dev, staging, prod or pr-*",
      )
    })

    it("throws error for typo in stage name", () => {
      expect(() => resolveStageConfig("production")).toThrow(
        "Unknown stage: production. Expected one of: dev, staging, prod or pr-*",
      )
    })

    it("throws error for empty string", () => {
      expect(() => resolveStageConfig("")).toThrow(
        "Unknown stage: . Expected one of: dev, staging, prod or pr-*",
      )
    })
  })

  describe("Configuration matrix", () => {
    it("dev and preview stages share GitHub environment", () => {
      const devConfig = resolveStageConfig(Stage.DEV)
      const previewConfig = resolveStageConfig("pr-123")

      expect(devConfig.GH_ENVIRONMENT).toBe("dev")
      expect(previewConfig.GH_ENVIRONMENT).toBe("dev")
    })

    it("only prod uses mainnet", () => {
      const stages = [Stage.DEV, Stage.STAGING, Stage.PROD]
      const networks = stages.map((stage) => resolveStageConfig(stage).NETWORK)

      expect(networks).toEqual(["testnet", "testnet", "mainnet"])
    })

    it("only staging and prod use minimal logging", () => {
      const stages = [Stage.DEV, Stage.STAGING, Stage.PROD]
      const loggingLevels = stages.map(
        (stage) => resolveStageConfig(stage).LOGGING,
      )

      expect(loggingLevels).toEqual(["verbose", "minimal", "minimal"])
    })

    it("only dev and preview use fast dunning", () => {
      const devConfig = resolveStageConfig(Stage.DEV)
      const previewConfig = resolveStageConfig("pr-123")
      const stagingConfig = resolveStageConfig(Stage.STAGING)
      const prodConfig = resolveStageConfig(Stage.PROD)

      expect(devConfig.DUNNING_MODE).toBe("fast")
      expect(previewConfig.DUNNING_MODE).toBe("fast")
      expect(stagingConfig.DUNNING_MODE).toBe("standard")
      expect(prodConfig.DUNNING_MODE).toBe("standard")
    })

    it("each GitHub environment maps correctly", () => {
      const devConfig = resolveStageConfig(Stage.DEV)
      const stagingConfig = resolveStageConfig(Stage.STAGING)
      const prodConfig = resolveStageConfig(Stage.PROD)

      const ghEnvironments = [
        devConfig.GH_ENVIRONMENT,
        stagingConfig.GH_ENVIRONMENT,
        prodConfig.GH_ENVIRONMENT,
      ]

      // All GH environments should be unique
      const uniqueGHEnvironments = new Set(ghEnvironments)
      expect(uniqueGHEnvironments.size).toBe(3)
      expect(ghEnvironments).toEqual(["dev", "staging", "prod"])
    })
  })
})
