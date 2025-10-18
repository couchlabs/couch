import path from "node:path"
import type { D1Database } from "@cloudflare/workers-types"
import * as schema from "@database/schema"
import { drizzle } from "drizzle-orm/d1"
import { migrate } from "drizzle-orm/d1/migrator"
import { Miniflare } from "miniflare"
import type { Address, Hash } from "viem"
import {
  type OrderStatus,
  type OrderType,
  SubscriptionStatus,
} from "@/constants/subscription.constants"
import type { Provider } from "@/providers/provider.interface"

// Get absolute path to migrations for monorepo compatibility
const MIGRATIONS_PATH = path.resolve(
  import.meta.dirname,
  "../database/migrations",
)

export interface TestSubscription {
  subscriptionId: Hash
  accountAddress: Address
  beneficiaryAddress: Address
  provider: Provider
  status?: SubscriptionStatus
  order?: {
    type: OrderType
    dueAt: string
    amount: string
    periodInSeconds: number
    status: OrderStatus
    attempts?: number
  }
}

export interface CreateTestDbOptions {
  /** Accounts to create for testing (addresses) */
  accounts?: Address[]
  /** Subscriptions to create for testing */
  subscriptions?: TestSubscription[]
}

/**
 * Creates an in-memory D1 database for testing
 * Uses Miniflare v4 D1 implementation
 * Automatically runs migrations and sets up schema
 */
export async function createTestDB(options: CreateTestDbOptions = {}): Promise<{
  db: D1Database // Raw D1Database for repositories
  dispose: () => Promise<void>
  orderIds: number[] // Order IDs created (in same order as subscriptions array)
}> {
  // Create Miniflare instance with in-memory D1 database
  const miniflare = new Miniflare({
    modules: true,
    script: "",
    d1Databases: ["TEST_DB"],
  })

  // Get D1 database binding
  const db = await miniflare.getD1Database("TEST_DB")

  // Create temporary Drizzle instance for migrations and setup
  const drizzleD1 = drizzle(db, { schema })

  // Run migrations from database/migrations (absolute path for monorepo compatibility)
  await migrate(drizzleD1, { migrationsFolder: MIGRATIONS_PATH })

  // Create test accounts if provided
  if (options.accounts) {
    for (const address of options.accounts) {
      await drizzleD1.insert(schema.accounts).values({ address }).run()
    }
  }

  // Create test subscriptions and track order IDs
  const orderIds: number[] = []
  if (options.subscriptions) {
    for (const sub of options.subscriptions) {
      // Insert subscription (default to PROCESSING status if not provided)
      await drizzleD1
        .insert(schema.subscriptions)
        .values({
          subscriptionId: sub.subscriptionId,
          accountAddress: sub.accountAddress,
          beneficiaryAddress: sub.beneficiaryAddress,
          provider: sub.provider,
          status: sub.status ?? SubscriptionStatus.PROCESSING,
        })
        .run()

      // Insert order if provided
      if (sub.order) {
        const result = await drizzleD1
          .insert(schema.orders)
          .values({
            subscriptionId: sub.subscriptionId,
            orderNumber: 1, // Hardcoded for test simplicity - single order per subscription
            type: sub.order.type,
            dueAt: sub.order.dueAt,
            amount: sub.order.amount,
            periodLengthInSeconds: sub.order.periodInSeconds,
            status: sub.order.status,
            attempts: sub.order.attempts ?? 0,
          })
          .returning({ id: schema.orders.id })

        orderIds.push(result[0].id)
      }
    }
  }

  return {
    db,
    dispose: async () => miniflare.dispose(),
    orderIds,
  }
}

/**
 * Helper to create an account in the test database
 * Required before creating subscriptions due to foreign key constraints
 */
export async function createTestAccount(
  db: D1Database,
  address: Address,
): Promise<void> {
  await drizzle(db, { schema })
    .insert(schema.accounts)
    .values({ address })
    .run()
}
