/**
 * Shared RPC types for API key operations
 * These types define the contract between merchant worker and backend RPC
 */

/**
 * API Key response (safe for client - no secrets)
 */
export interface ApiKeyResponse {
  id: number
  name: string
  prefix: string
  start: string
  enabled: boolean
  createdAt: string
  lastUsedAt?: string
}

/**
 * Create API Key response (includes full key one-time only)
 */
export interface CreateApiKeyResponse extends ApiKeyResponse {
  apiKey: string // Full key - only returned on creation
}
