# Couch

Stablecoin recurring payments infrastructure.

Couch is an offchain orchestrator for SpendPermission-based recurring payments. While SpendPermissions provide onchain authorization primitives, Couch handles the coordination layer: scheduling charges, managing subscription state, processing payments and delivering webhooks to merchants.

## What's in this repo

```
couch/         
├── platform/ 
│ ├── backend/  Offchain orchestrator for recurring payments 
│ └── app/      Main apps for merchants to manage their accounts and subscriptions
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

Configure your environment variables

3. **Start the platform**

```bash
bun dev 
```

This will spin up locally the database, workers, durable objexts, events queues apis and rpc infrastructure, together with the merchant application to access it. 
The merchant app should should now be available at `http://localhost:8000`

## Stack

- Offchain: [Cloudflare](https://www.cloudflare.com/developer-platform/products/)
- Onchain: [Coinbase](https://www.coinbase.com/developer-platform)
- IAC: [Alchemy](https://alchemy.run/)

## Resources

  - [Couch](https://cou.ch) - Join the waitlist to be among the first to accept stablecoin subscriptions
  - [SpendPermission Smart Contract](https://github.com/coinbase/spend-permissions) - Onchain authorization primitives powering Couch
