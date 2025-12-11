/**
 * Merchant Worker - Secure RPC Proxy
 *
 * Acts as a same-origin proxy for internal RPC calls to the backend.
 * Provides minimal API surface and enforces security via CDP JWT authentication.
 */

import { sameOrigin } from "@app-api/middleware/same-origin.middleware"
import { accountRoutes } from "@app-api/routes/account.routes"
import { keysRoutes } from "@app-api/routes/keys.routes"
import { subscriptionsRoutes } from "@app-api/routes/subscriptions.routes"
import { webhookRoutes } from "@app-api/routes/webhook.routes"
import type { ApiWorkerEnv } from "@app-types/api.env"
import { Hono } from "hono"

const app = new Hono<{ Bindings: ApiWorkerEnv }>().basePath("/api")

// Security: Same-origin check for all routes
app.use(sameOrigin())

// Mount routes
app.route("/account", accountRoutes)
app.route("/keys", keysRoutes)
app.route("/webhook", webhookRoutes)
app.route("/subscriptions", subscriptionsRoutes)

// 404 for everything else
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404)
})

export default app
