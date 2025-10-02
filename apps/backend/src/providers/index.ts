import { ProviderFactory } from "./provider.factory"

// Singleton instance - automatically configured based on environment
export const providers = new ProviderFactory()

// Re-export types for convenience
export { Provider, type SubscriptionProvider } from "./provider.interface"
