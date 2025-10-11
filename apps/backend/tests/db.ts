import * as schema from "@database/schema"
import { D1Database, D1DatabaseAPI } from "@miniflare/d1"
import { createSQLiteDB } from "@miniflare/shared"
import type { DrizzleD1Database } from "drizzle-orm/d1"
import { drizzle } from "drizzle-orm/d1"
import { migrate } from "drizzle-orm/d1/migrator"
import type { Address } from "viem"

/**
 * Creates an in-memory D1 database for testing
 * Uses Miniflare's D1 implementation backed by SQLite
 */
export async function createTestDb(): Promise<
  DrizzleD1Database<typeof schema>
> {
  const sqliteDb = await createSQLiteDB(":memory:")
  const d1db = new D1Database(new D1DatabaseAPI(sqliteDb))
  const db = drizzle(d1db, { schema })

  // Run migrations from database/migrations
  await migrate(db, { migrationsFolder: "./database/migrations" })

  return db
}

/**
 * Helper to create an account in the test database
 * Required before creating subscriptions due to foreign key constraints
 */
export async function createTestAccount(
  db: DrizzleD1Database<typeof schema>,
  address: Address,
): Promise<void> {
  await db.insert(schema.accounts).values({ address }).run()
}
