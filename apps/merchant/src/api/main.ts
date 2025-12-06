/**
 * Merchant Worker - Secure RPC Proxy
 *
 * Acts as a same-origin proxy for internal RPC calls to the backend.
 * Enforces security by validating origin and provides minimal API surface.
 */

import { isAddress } from "viem"
import type { WorkerEnv } from "../../types/env.d.ts"

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    // Only handle /api/account POST
    if (url.pathname === "/api/account" && request.method === "POST") {
      // Same-origin policy enforcement
      const origin = request.headers.get("Origin")
      if (origin && origin !== url.origin) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }

      try {
        const { address } = (await request.json()) as {
          address?: string
        }

        if (!address || !isAddress(address)) {
          return Response.json({ error: "Invalid evmAddress" }, { status: 400 })
        }

        const result = await env.COUCH_BACKEND_RPC.getOrCreateAccount({
          address,
        })
        return Response.json(result)
      } catch (error) {
        console.error("Account sync error:", error)
        return Response.json({ error: "Internal error" }, { status: 500 })
      }
    }

    // 404 for everything else
    return Response.json({ error: "Not found" }, { status: 404 })
  },
}
