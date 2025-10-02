import { env } from "cloudflare:workers"
import { isTestnetEnvironment, type Stage } from "@/constants/env.constants"
import { BaseProvider } from "./base.provider"
import { Provider, type SubscriptionProvider } from "./provider.interface"

export class ProviderFactory {
  private providers = new Map<Provider, SubscriptionProvider>()

  constructor() {
    const testnet = isTestnetEnvironment(env.STAGE as Stage)
    this.providers.set(Provider.BASE, new BaseProvider(testnet))
  }

  getProvider(providerId: Provider): SubscriptionProvider {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not supported`)
    }
    return provider
  }
}
