# Treidin Market Data

The first phase of a local market-data platform for Binance USD-M Futures. It receives 1-minute BTCUSDT and ETHUSDT candles, maintains historical data, repairs gaps, creates higher timeframes, and provides an operations dashboard. Persistence is exclusively SQLite; PostgreSQL, Docker, and infrastructure services are not required.

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

## Scope

Includes ingestion, historical data, data quality, aggregation, observability, and the dashboard. It does not include strategies, agents, backtesting, paper trading, positions, or order execution.
