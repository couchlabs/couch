/**
 * API Client with CDP Authentication
 *
 * This module provides a fetch wrapper that automatically injects
 * CDP JWT tokens into requests for authentication.
 */

/**
 * Interface for getting the CDP access token
 * This should be provided by the component using useGetAccessToken
 */
export interface TokenProvider {
  getAccessToken: () => Promise<string | null>
}

/**
 * Authenticated fetch wrapper
 * Automatically includes CDP JWT token in Authorization header
 *
 * @throws Error if no access token is available
 */
export async function authenticatedFetch(
  url: string,
  tokenProvider: TokenProvider,
  options: RequestInit = {},
): Promise<Response> {
  // Get the CDP JWT token
  const token = await tokenProvider.getAccessToken()

  if (!token) {
    throw new Error("No access token available - user may not be authenticated")
  }

  // Merge headers with Authorization
  const headers = new Headers(options.headers)
  headers.set("Authorization", `Bearer ${token}`)

  // Make the request
  return fetch(url, {
    ...options,
    headers,
  })
}
