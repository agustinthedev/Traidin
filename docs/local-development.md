# Local development and operations

## Configuration

Copy `.env.example` to `.env`. `DATABASE_URL` accepts `sqlite:///./data/trading-platform.db`; its directory is created automatically. `SYMBOLS` and `AGGREGATED_TIMEFRAMES` are configurable lists. REST/WS endpoints, timeouts, backoff, batch size, retention, host/port, logging, and backups are also controlled through the variables documented in the example file.

Credentials are optional. Only the backend can read them; the frontend receives only configured/not-configured flags. Pino redacts sensitive headers and field names. Keys are never stored in SQLite, and there are no order endpoints.

## Running without Docker

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev:api
```

Run `npm run dev` in another terminal. At startup, the backend applies migrations, checks integrity, requests REST/metadata, recovers interrupted jobs, checks recent continuity, and connects the public kline stream.

## Flows

- Live: open updates remain in memory; only `x=true` is validated, written idempotently, and emitted as `CANDLE_CLOSED`/`CANDLE_PERSISTED`.
- Historical: pages in chronological order, commits batches, stores a post-commit checkpoint, and supports pause, cancellation, retry, and restart recovery.
- Gaps: compares aligned timestamps, deduplicates ranges, downloads only missing candles with `REST_GAP_REPAIR`, and rebuilds affected aggregates.
- Aggregation: closed 1m candles are canonical. 5m, 15m, 1h, 4h, 1d, and 1w candles are built in UTC. Days begin at 00:00 UTC; 4h aligns to 00/04/08/12/16/20; weeks begin Monday at 00:00 UTC. A bucket with missing minutes is marked incomplete and triggers repair.

## Jobs, health, and rate limits

`RUNNING`/`CANCELLING` jobs return to `PENDING` on startup and resume from their checkpoint. The adapter corrects clock skew through `/time`, records weight headers, applies timeouts, and uses exponential backoff with jitter. Health combines the application, SQLite, writer, REST, WebSocket, persistence, historical worker, repair, aggregation, and SSE; recent gaps or a stalled stream degrade the state.

## Migrations and maintenance

Migrations live in `server/db/migrations` and are recorded in `schema_migrations`. Do not modify an applied migration; add a new version instead. Use `npm run db:backup` before important changes, `npm run db:optimize` for safe maintenance, and the Database page for checkpoints and backups. The database file, WAL, development backups, and `.env` are ignored by Git.

## Verification

Run `npm run typecheck`, `npm test`, `npm run test:integration`, and `npm run build`. `npm run perf:sqlite` creates an ignored database under `data/performance`, inserts 250,000 candles in bulk, interleaves live writes and reads, and reports throughput, latency, size, idempotency, and locks. If the backend runs on 4100, it also measures health responses during load.
