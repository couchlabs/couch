# Couch

Stablecoin recurring billing made easy.

Couch is an offchain orchestrator for SpendPermission-based recurring payments. While SpendPermissions provide onchain authorization primitives, Couch handles the coordination layer: scheduling charges, managing subscription state, processing payments and delivering webhooks to merchants. 

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

4. **Create an account**

Register your wallet address to get an API key:

```bash
curl -X PUT http://localhost:3000/api/account \
  -H "Content-Type: application/json" \
  -d '{"address": "YOUR_WALLET_ADDRESS"}'
```

Copy the returned API key and add it to your `.env`:

```
COUCH_API_KEY=your_api_key_here
```

5. **Register the demo webhook**

```bash
curl -X PUT http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"url": "http://localhost:8000/api/webhook"}'
```

Copy the returned webhook secret and add it to your `.env`:

```
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

## What's in this repo

```
couch/
├── apps/
│ ├── backend/      Offchain infra handling stablecoins subscriptions
│ └── demo/         Playground application for testing
└── ...             Monorepo configuration files
```

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