import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./backend/src/database/schema.ts",
  out: "./backend/src/database/migrations",
  dialect: "sqlite",
  migrations: {
    table: "drizzle_migrations",
  },
})
