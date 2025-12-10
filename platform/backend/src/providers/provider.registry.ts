import {
  BaseProvider,
  type BaseProviderDeps,
} from "@backend/providers/base.provider"
import {
  Provider,
  type SubscriptionProvider,
} from "@backend/providers/provider.interface"

export interface ProviderRegistryDeps {
  Base: BaseProviderDeps
  // Future providers will be added here
  // Ethereum?: EthereumProviderDeps
}

export class ProviderRegistry {
  private providers = new Map<Provider, SubscriptionProvider>()

  constructor(deps: ProviderRegistryDeps) {
    this.providers.set(Provider.BASE, new BaseProvider(deps.Base))
  }

  get(providerId: Provider): SubscriptionProvider {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not supported`)
    }
    return provider
  }
}
