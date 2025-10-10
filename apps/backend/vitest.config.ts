import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["tests/e2e/**"], // Exclude E2E tests
    coverage: {
      provider: "v8",
      reporter: ["text"], // Only terminal output
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "database/**",
        "**/.alchemy/**", // Exclude alchemy build output
        "**/node_modules/**", // Exclude dependencies
        "tests/**", // Exclude test helpers
        "**/*.test.ts", // Exclude test files from coverage
        "**/*.config.ts", // Exclude config files
      ],
    },
    testTimeout: 5000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@database": path.resolve(__dirname, "./database"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
})
