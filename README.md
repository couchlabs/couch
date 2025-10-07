# Couch

Stablecoin recurring billing made easy.

Couch is an offchain orchestrator for SpendPermission-based recurring payments. While SpendPermissions provide onchain authorization primitives, Couch handles the coordination layer: scheduling charges, managing subscription state, processing payments and delivering webhooks to merchants.

## What's in this repo

```
couch/
├── apps/
│ ├── backend/      Offchain orchestrator for recurring payments
│ └── demo/         Playground application for testing
```

## Getting started

1. **Install dependencies**

```bash
bun install
```

2. **Add your secrets & envs**

```bash
cp .env.example .env
```

Configure your backend `CDP_*` environment variables

3. **Start the backend**

```bash
bun dev --filter=backend
```

4. **Create an account and register webhook**

First, create your account and get an API key:

```bash
curl -X PUT http://localhost:3000/api/account \
  -H "Content-Type: application/json" \
  -d '{"address": "YOUR_WALLET_ADDRESS"}'
```

Use the returned `api_key` to register the webhook:

```bash
curl -X PUT http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"url": "http://localhost:8000/api/webhook"}'
```

5. **Update your environment**

Add both values to your `.env`:

```
COUCH_API_KEY=your_api_key_here
COUCH_WEBHOOK_SECRET=your_webhook_secret_here
```

6. **Start the demo**

```bash
bun dev --filter=demo
```

Your demo should now be fully functional at `http://localhost:8000`

**Notes:**
> - You can start both backend and demo together with just `bun dev`
> - For backend-specific instructions (testing, endpoints, architecture), see the [Backend README](./apps/backend/README.md).

## Scripts

If you need to add funds to your CDP spender account (on base sepolia), run the faucet script:

```bash
bun faucet
```

## Stack

- Offchain: [Cloudflare](https://www.cloudflare.com/developer-platform/products/)
- Onchain: [Coinbase](https://www.coinbase.com/developer-platform)
- IAC: [Alchemy](https://alchemy.run/)

## Resources

  - [Couch](https://cou.ch) - Join the waitlist to be among the first to accept stablecoin subscriptions
  - [SpendPermission Smart Contract](https://github.com/coinbase/spend-permissions) - Onchain authorization primitives powering Couch