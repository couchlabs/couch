# Couch

Stablecoin recurring billing made easy.

Couch is an offchain orchestrator for SpendPermission-based recurring payments. While SpendPermissions provide onchain authorization primitives, Couch handles the coordination layer: scheduling charges, managing subscription state, processing payments and delivering webhooks to merchants. 

## Getting started

1. Install dependencies

```bash
bun install
```

2. Add your secrets & envs

```bash
cp .env.example .env
```

3. Run dev

```bash
bun dev
```

> **Note:** For backend-specific instructions (testing, endpoints, architecture), see the [Backend README](./apps/backend/README.md).

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