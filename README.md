<div align="center">

# Mythic Explorer API

[![API](https://img.shields.io/badge/api-mythic.sh-39FF14?style=flat-square)](https://api.mythic.sh)
[![Built by](https://img.shields.io/badge/built%20by-MythicLabs-7B2FFF?style=flat-square)](https://mythiclabs.io)
![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL_1.1-blue.svg)
[![Fastify](https://img.shields.io/badge/fastify-5.2-black?style=flat-square&logo=fastify)](https://fastify.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)

**REST API for the Mythic L2 block explorer. Query blocks, transactions, accounts, tokens, and bridge activity.**

[API Base URL](https://api.mythic.sh) &middot; [Block Explorer](https://explorer.mythic.sh) &middot; [Documentation](https://mythic.sh/docs)

</div>

---

## Overview

Mythic Explorer API is a high-performance REST service that indexes the Mythic L2 blockchain and exposes it through a clean, developer-friendly API. It connects directly to the Mythic L2 RPC node, caches frequently accessed data in a local SQLite database, and serves structured JSON responses for the block explorer frontend, wallets, and third-party integrations.

## Base URL

```
https://api.mythic.sh
```

## API Reference

### Health & Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check and uptime status |
| `GET` | `/stats` | Network statistics (TPS, slot height, epoch info) |
| `GET` | `/supply` | MYTH token supply data |

### Blocks & Slots

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/blocks` | Recent confirmed blocks |
| `GET` | `/blocks/:slot` | Block details by slot number |
| `GET` | `/slots` | Recent slot information |
| `GET` | `/slot/:slot` | Slot details with transaction list |

### Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/transactions` | Recent transactions (paginated) |
| `GET` | `/transactions/:signature` | Transaction details by signature |
| `GET` | `/tx/:signature` | Transaction details (alias) |

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/accounts/:address` | Account information, balance, and token holdings |
| `GET` | `/accounts/:address/transactions` | Transaction history for an account |
| `GET` | `/account/:address` | Account info (alias) |
| `GET` | `/account/:address/transactions` | Account transaction history (alias) |

### Tokens

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/tokens` | All known token mints on Mythic L2 |
| `GET` | `/token/:mint` | Token details by mint address |

### Programs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/programs` | Deployed programs with labels and stats |

### Bridge

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/bridge/stats` | Bridge volume and deposit/withdrawal counts |
| `GET` | `/bridge/transactions` | Recent bridge transactions |

## Response Format

All endpoints return JSON. Successful responses follow this structure:

```json
{
  "name": "Mythic L2 Explorer API",
  "version": "1.1.0",
  "data": { ... }
}
```

Error responses include a descriptive message:

```json
{
  "error": "Account not found",
  "statusCode": 404
}
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) >= 18
- npm >= 9
- Access to a Mythic L2 RPC node

### Installation

```bash
git clone https://github.com/MythicFoundation/mythic-explorer-api.git
cd mythic-explorer-api
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
L2_RPC_URL=http://127.0.0.1:8899
PORT=4000
CACHE_TTL_MS=5000
LOG_LEVEL=info
DB_PATH=./data/explorer-cache.db
```

### Development

```bash
npm run dev
```

The API will be available at [http://localhost:4000](http://localhost:4000).

### Production Build

```bash
npm run build
npm start
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Fastify 5.2](https://fastify.dev) |
| Language | [TypeScript 5.7](https://typescriptlang.org) |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (local cache) |
| Blockchain | [@solana/web3.js 1.98](https://solana-labs.github.io/solana-web3.js/) |
| Logging | [Pino](https://github.com/pinojs/pino) with [pino-pretty](https://github.com/pinojs/pino-pretty) |
| CORS | [@fastify/cors](https://github.com/fastify/fastify-cors) |

## Architecture

```
mythic-explorer-api/
├── src/
│   ├── index.ts          # Fastify server entrypoint
│   ├── config.ts         # Environment configuration
│   ├── rpc.ts            # Solana RPC client wrapper
│   ├── cache.ts          # SQLite caching layer
│   └── routes/
│       ├── health.ts     # /health endpoint
│       ├── stats.ts      # /stats, /supply endpoints
│       ├── slots.ts      # /blocks, /slots endpoints
│       ├── transactions.ts  # /transactions, /tx endpoints
│       ├── accounts.ts   # /accounts, /account endpoints
│       ├── tokens.ts     # /tokens, /token endpoints
│       ├── programs.ts   # /programs endpoint
│       ├── bridge.ts     # /bridge/* endpoints
│       └── aliases.ts    # Convenience route aliases
├── data/                 # SQLite database storage
├── dist/                 # Compiled JavaScript output
├── ecosystem.config.cjs  # PM2 process configuration
├── tsconfig.json
└── package.json
```

## Known Programs

The API automatically labels known Mythic L2 programs in transaction and account responses:

| Program | Description |
|---------|-------------|
| Mythic Bridge L1 | Cross-chain bridge (Solana side) |
| Mythic Bridge L2 | Cross-chain bridge (Mythic side) |
| MythicSwap AMM | Automated market maker DEX |
| AI Precompiles | GPU inference acceleration |
| Compute Market | Decentralized compute marketplace |
| MYTH Token | Native token program with fee burns |
| MythicPad Launchpad | Token launchpad with bonding curves |
| Governance | On-chain DAO governance |
| Staking | Validator staking program |

## Related Projects

- [mythic-mainnet-beta](https://github.com/MythicFoundation/mythic-mainnet-beta) -- Mythic L2 validator and on-chain programs
- [mythic-wallet-site](https://github.com/MythicFoundation/mythic-wallet-site) -- Web wallet frontend
- [mythic-supply-oracle](https://github.com/MythicFoundation/mythic-supply-oracle) -- Canonical supply tracking API

## License


This project is licensed under the [Business Source License 1.1](./LICENSE). The Licensed Work will convert to MIT License on February 25, 2028.
