import type { MiddlewareHandler } from "hono"

/**
 * Same-origin enforcement middleware
 * Blocks requests that don't originate from the same origin
 * Uses the sec-fetch-site header (browser security feature)
 */
export function sameOrigin(): MiddlewareHandler {
  return async function sameOriginHandler(c, next) {
    const secFetchSite = c.req.header("sec-fetch-site")

    // Only allow same-origin requests (from the app itself)
    // Browsers automatically set this header - can't be spoofed
    if (secFetchSite !== "same-origin") {
      return c.json({ error: "Forbidden" }, 403)
    }

    return next()
  }
}
