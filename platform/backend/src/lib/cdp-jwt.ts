import { ErrorCode, HTTPError } from "@backend/errors/http.errors"
import { createLogger } from "@backend/lib/logger"
import { CdpClient } from "@coinbase/cdp-sdk"

const logger = createLogger("cdp-jwt")

interface CDPJWTPayload {
  sub: string
  project_id: string
  iss: string
  aud: string
  exp: number
  iat: number
}

/**
 * Decodes JWT payload without verification (for project_id extraction)
 */
function decodeJWT(token: string): CDPJWTPayload {
  const parts = token.split(".")
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format")
  }

  const payload = parts[1]
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
  return JSON.parse(decoded)
}

/**
 * Validates CDP JWT token and returns the CDP user ID
 *
 * @param jwt - The CDP JWT token from Authorization header
 * @param projectId - Expected CDP project ID
 * @param apiKeyId - CDP API key ID for validation
 * @param apiKeySecret - CDP API key secret for validation
 * @returns The verified CDP user ID (from 'sub' claim)
 * @throws Error if validation fails
 */
export async function validateCDPJWT(
  jwt: string,
  projectId: string,
  apiKeyId: string,
  apiKeySecret: string,
): Promise<string> {
  const cdpClient = new CdpClient({
    apiKeyId,
    apiKeySecret,
  })

  try {
    // Validate token with CDP's server-side API
    const endUser = await cdpClient.endUser.validateAccessToken({
      accessToken: jwt,
    })

    // Extract and verify project_id from token
    const payload = decodeJWT(jwt)

    if (payload.project_id !== projectId) {
      throw new Error(
        `Project ID mismatch: expected ${projectId}, got ${payload.project_id}`,
      )
    }

    // Return the verified CDP user ID
    return endUser.userId
  } catch (error) {
    // Convert to Error for consistent handling
    const originalError =
      error instanceof Error ? error : new Error(String(error))

    // Log with full context
    logger.error("CDP JWT validation failed", {
      error: originalError,
      message: originalError.message,
      stack: originalError.stack,
    })

    // Throw structured HTTP error
    throw new HTTPError(
      401,
      ErrorCode.UNAUTHORIZED,
      "Invalid or expired authentication token",
      { originalError: originalError.message },
    )
  }
}
