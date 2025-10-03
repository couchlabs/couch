# Couch

[Subscriptions for a new era of payments](https://cou.ch).

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
couch-poc/
├── apps/
│ ├── backend/      Offchain infra handling stablecoins subscriptions
│ └── demo/         Web application that rely on backend
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
