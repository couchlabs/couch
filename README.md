# Couch POC

[Subscriptions for the digital age](https://cou.ch).

## Getting started

1. Install dependencies:

```bash
bun install
```

2. Add your secrets & envs

```bash
cp .env.example .env
```

3. Run init script to initialize & fund CDP Wallets

```bash
bun cdp:init
```

4. Run dev:

```bash
bun dev
```

## What's in this repo

```
couch-poc/
├── apps/
│ ├── backend/      Offchain infra handling stablecoins subscriptions
│ └── frontend/     Web application accepting subscriptions
├── scripts/        Setup scripts
└── ...             Monorepo configuration files
```

## Scripts

If you need to add funds to your wallets (on base sepolia), run the faucet script:

```bash
bun cdp:faucet
```
