# Couch Backend v4 - Provider Abstraction

**Status**: Draft
**Target**: Minimal changes to support multiple subscription providers

## Overview

Enable the system to support multiple subscription providers (Base SDK, Provider X, etc.) with minimal architectural changes. The goal is to decouple from Base SDK while maintaining backward compatibility.

## Core Changes

### 1. Database Schema Update

**Add provider column to subscriptions table:**

```sql
-- Migration: Add provider support (edit existing 0001_init_subscription_order_schema.sql)
ALTER TABLE subscriptions ADD COLUMN provider_id TEXT NOT NULL CHECK(provider_id IN ('base'));
-- Future: ALTER TABLE subscriptions DROP CONSTRAINT check_provider_id;
-- Future: ALTER TABLE subscriptions ADD CONSTRAINT check_provider_id CHECK(provider_id IN ('base', 'provider-x'));
```

**No database defaults**: Force explicit provider specification at API level to ensure system completeness.

### 2. Provider Interface

**Create provider abstraction with 3 core methods:**

```typescript
// src/providers/provider.interface.ts

// Provider enum aligned with database CHECK constraint
export enum Provider {
  BASE = 'base',
  // Future: PROVIDER_X = 'provider-x'
}

export interface SubscriptionProvider {
  readonly providerId: Provider

  chargeSubscription(params: ChargeParams): Promise<ChargeResult>
  getSubscriptionStatus(params: StatusParams): Promise<StatusResult>
  validateSubscriptionId(id: string): boolean
}

export interface ChargeParams {
  subscriptionId: string
  amount: string
  recipient: Address
  // No config needed - providers are pre-configured with credentials
}

export interface ChargeResult {
  transactionHash: Hash
  success: boolean
  gasUsed?: string
}

export interface StatusParams {
  subscriptionId: string
  // No config needed - providers are pre-configured
}

export interface StatusResult {
  isActive: boolean
  subscriptionOwner: Address
  remainingChargeInPeriod?: number
}
```

### 3. Base Provider Implementation

**Move existing Base SDK logic into provider:**

```typescript
// src/providers/base.provider.ts
export class BaseProvider implements SubscriptionProvider {
  readonly providerId = Provider.BASE
  private readonly testnet: boolean
  private readonly cdpConfig: {
    apiKeyId: string
    apiKeySecret: string
    walletSecret: string
    walletName: string
    paymasterUrl: string
    spenderAddress: Address
  }

  constructor(testnet: boolean) {
    this.testnet = testnet
    this.cdpConfig = {
      apiKeyId: env.CDP_API_KEY_ID,
      apiKeySecret: env.CDP_API_KEY_SECRET,
      walletSecret: env.CDP_WALLET_SECRET,
      walletName: env.CDP_WALLET_NAME,
      paymasterUrl: env.CDP_PAYMASTER_URL,
      spenderAddress: env.CDP_SPENDER_ADDRESS,
    }
  }

  async chargeSubscription(params: ChargeParams): Promise<ChargeResult> {
    // Move existing base.subscription.charge() logic here
    // Use this.cdpConfig and this.testnet
  }

  async getSubscriptionStatus(params: StatusParams): Promise<StatusResult> {
    // Move existing base.subscription.getStatus() logic here
  }

  validateSubscriptionId(id: string): boolean {
    return isHash(id)
  }
}
```

### 4. Provider Factory

**Registry for managing providers:**

```typescript
// src/providers/provider.factory.ts 
export class ProviderFactory {
  private providers = new Map<Provider, SubscriptionProvider>()

  constructor(testnet: boolean) {
    this.providers.set(Provider.BASE, new BaseProvider(testnet))
    // Future: this.providers.set(Provider.PROVIDER_X, new ProviderXProvider(testnet))
  }

  getProvider(providerId: Provider): SubscriptionProvider {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider ${providerId} not supported`)
    }
    return provider
  }
}
```

### 5. Repository Updates

**Update OnchainRepository to use provider factory:**

```typescript
// src/repositories/onchain.repository.ts
export class OnchainRepository {
  constructor(private providerFactory: ProviderFactory) {}

  async chargeSubscription(params: ChargeSubscriptionParams & { providerId: string }): Promise<ChargeSubscriptionResult> {
    const provider = this.providerFactory.getProvider(params.providerId)

    const result = await provider.chargeSubscription({
      subscriptionId: params.subscriptionId,
      amount: params.amount,
      recipient: params.recipient,
      config: this.getProviderConfig(params.providerId)
    })

    return {
      transactionHash: result.transactionHash,
      gasUsed: result.gasUsed
    }
  }

  async getSubscriptionStatus(params: GetSubscriptionStatusParams & { providerId: string }): Promise<SubscriptionStatusResult> {
    const provider = this.providerFactory.getProvider(params.providerId)
    // ... delegate to provider
  }

  async validateSubscriptionId(params: ValidateSubscriptionIdParams & { providerId: string }): Promise<boolean> {
    const provider = this.providerFactory.getProvider(params.providerId)
    return provider.validateSubscriptionId(params.subscriptionId)
  }

  private getProviderConfig(providerId: string): ProviderConfig {
    // Centralized provider configuration - needed to pass auth/network config to each provider // still not sure if we need it now or need it at all, wouldnt a provider be already configured when getProvider() ??
    // For now, return current CDP config for 'base'
    // Future: load provider-specific configs
    if (providerId === 'base') {
      return {
        apiKeyId: env.CDP_API_KEY_ID,
        apiKeySecret: env.CDP_API_KEY_SECRET,
        walletSecret: env.CDP_WALLET_SECRET,
        walletName: env.CDP_WALLET_NAME,
        paymasterUrl: env.CDP_PAYMASTER_URL,
        spenderAddress: env.CDP_SPENDER_ADDRESS,
        testnet: this.testnet
      }
    }
    throw new Error(`No config for provider: ${providerId}`)
  }
}
```

### 6. Service Layer Updates

**Pass provider_id through the flow:**

```typescript
// src/services/subscription.service.ts
export class SubscriptionService {
  async activate(params: ActivateSubscriptionParams): Promise<ActivationResult> {
    // ... existing validation logic

    // Get provider from database (future: detect from subscription_id)
    const subscription = await this.subscriptionRepository.getSubscription({ subscriptionId }) // Returns provider_id from database
    const providerId = subscription.providerId // Always present - no fallback needed since we require it 

    // Pass provider to onchain operations
    const status = await this.onchainRepository.getSubscriptionStatus({ // THIS IS one way, the other way could be when we initialize service to pass the provider type to it so that we dont have to specify every call, please discuss pro/cons
      subscriptionId,
      providerId
    })

    const chargeResult = await this.onchainRepository.chargeSubscription({
      subscriptionId,
      amount,
      recipient,
      providerId
    })

    // ... rest of logic
  }
}
```

### 7. Database Repository Updates

**Store and retrieve provider_id:**

```typescript
// src/repositories/subscription.repository.ts
export interface CreateSubscriptionParams {
  subscriptionId: Hash
  ownerAddress: Address
  providerId: Provider // Required - must be passed explicitly from API endpoint
}

export interface SubscriptionResult {
  subscriptionId: Hash
  ownerAddress: Address
  status: SubscriptionStatus
  providerId: Provider // Include in results
}

export class SubscriptionRepository {
  async createSubscription(params: CreateSubscriptionParams): Promise<void> {
    await this.db
      .prepare(`INSERT INTO subscriptions (subscription_id, owner_address, status, provider_id) VALUES (?, ?, ?, ?)`)
      .bind(params.subscriptionId, params.ownerAddress, SubscriptionStatus.PROCESSING, params.providerId)
      .run()
  }

  // Update all queries to include provider_id in SELECT statements
}
```

## Future Enhancements (Out of Scope for v4)

### API Endpoint Updates
```typescript
// Accept provider in subscription creation (implement in v4)
POST /api/subscriptions
{
  "subscription_id": "0x...",
  "provider": "base" // Required field - must be valid Provider enum value
}

// API validation logic
import { Provider } from "@/providers/provider.interface"

// In subscription route handler:
if (!req.body.provider) {
  throw new HTTPError(400, ErrorCode.MISSING_FIELD, "provider is required")
}

if (!Object.values(Provider).includes(req.body.provider)) {
  throw new HTTPError(
    400,
    ErrorCode.INVALID_FORMAT,
    `Invalid provider. Supported providers: ${Object.values(Provider).join(', ')}`
  )
}
```


## Implementation Checklist

- [ ] Create provider interface
- [ ] Implement BaseProvider (move existing Base SDK logic)
- [ ] Create ProviderFactory
- [ ] Update OnchainRepository to use factory
- [ ] Add provider_id column to database
- [ ] Update SubscriptionRepository to store/retrieve provider_id
- [ ] Update SubscriptionService to pass provider_id
- [ ] Update OrderService to pass provider_id for recurring payments
- [ ] Test existing functionality still works
- [ ] Add provider_id to webhook events (optional)

## Breaking Changes (Acceptable - Not Deployed Yet)

🔄 **Database schema change** - Add required provider_id column
🔄 **API change required** - POST /api/subscriptions now requires "provider" field
✅ **No environment variable changes** required for now
✅ **Existing Base SDK logic** moved but unchanged

## Benefits

- **Zero disruption** to current functionality
- **Foundation for multi-provider** support
- **Clean abstraction** between business logic and provider SDKs
- **Easy to add Provider X** in the future
- **Database audit trail** of which provider handles each subscription