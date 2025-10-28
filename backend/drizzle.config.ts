import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./database/schema.ts",
  out: "./database/migrations",
  dialect: "sqlite",
  migrations: {
    table: "drizzle_migrations",
  },
})
