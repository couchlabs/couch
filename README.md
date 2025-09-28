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

## What's in this repo

```
couch-poc/
├── apps/
│ ├── backend/      Offchain infra handling stablecoins subscriptions
│ └── frontend/     Web application accepting subscriptions
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
