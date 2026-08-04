# Treidin Market Data & Research

Treidin is a local market-data and strategy-research platform for Binance USD-M Futures. It receives 1-minute BTCUSDT and ETHUSDT candles, maintains historical data, repairs gaps, creates higher timeframes, and provides an operations dashboard. The research workspace supports versioned strategies, candidate generation, and reproducible offline verification. Persistence is exclusively SQLite; PostgreSQL, Docker, and infrastructure services are not required.

## Quick start

Requirements: Node.js 22.13 or later.

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
```

Run these commands in two terminals:

```powershell
npm run dev:api
npm run dev
```

Backend: `http://127.0.0.1:4100`. The frontend prints its local port at startup (usually 3000; choose another if it is already in use). Binance public streams and endpoints do not require credentials. `BINANCE_API_KEY` and `BINANCE_API_SECRET` are optional, backend-only, and are never persisted or exposed.

## Commands

```text
npm test                 unit tests and temporary SQLite database
npm run test:integration real Binance public integration tests
npm run typecheck        TypeScript validation
npm run build            production build
npm run perf:sqlite      local 250,000-candle performance test
npm run db:backup        consistent backup with VACUUM INTO
npm run db:optimize      PRAGMA optimize + ANALYZE
```

Configuration is documented in [local development](docs/local-development.md), the design in [architecture](docs/architecture.md), storage in [SQLite storage design](docs/sqlite-storage-design.md), the [performance test](docs/performance-results.md), and live-stream inspection in [Binance WebSocket payload analysis](docs/binance-websocket-payload-analysis.md).

## Research workspace

The dashboard's Research section provides:

- **Strategies**: a catalog of strategy definitions, immutable versions, lifecycle state, verification coverage, and research provenance.
- **Strategy Builder**: create and publish strategy versions from the backend indicator registry.
- **Strategy Lab**: define reproducible research runs across in-sample, out-of-sample, and holdout periods; generate and rank candidates; inspect persisted outcomes; and promote holdout-confirmed candidates into versioned strategies.
- **Strategy Verifier**: check historical availability and indicator warmup, then run offline verification with reproducible metrics and diagnostic reports.

Research runs and verification are local simulations over persisted market data. They do not place orders or connect to a trading account.

## Scope

Includes ingestion, historical data, data quality, aggregation, observability, strategy research, offline simulation, verification, and the dashboard. It does not include paper trading, positions, live trading, or order execution.
