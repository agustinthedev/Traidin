# SQLite storage design

## Decision and volume

SQLite is the required local database: it simplifies installation and operation, keeps the dataset portable, and supports several million candles when queries are indexed and writes are batched. Two symbols with two years of 1m data represent approximately 2.1 million canonical rows, plus aggregates, jobs, gaps, metadata, and events.

Prices and quantities are stored as canonical decimal text and calculated with `decimal.js`; `REAL` is not used for financial arithmetic. Timestamps are stored as UTC epoch milliseconds. The unique identity is `(exchange, market, symbol, timeframe, open_time)`.

## WAL and connections

Database startup applies `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`, `temp_store=MEMORY`, a bounded negative cache size, and `mmap_size`. `NORMAL` avoids an extra fsync per transaction while retaining WAL-appropriate durability; it does not disable synchronization. There is one dedicated writer connection and one reader connection. Dashboard reads continue while the writer commits short batches.

## Writer coordination

All producers use `SQLiteWriter`, a stable priority queue:

1. closed live candles;
2. gap repair;
3. metadata;
4. jobs and events;
5. backfill;
6. aggregate rebuilds.

A single writer executes transactions, retries `SQLITE_BUSY` with bounded waits, and exposes queue depth, latency, and retry metrics. Backfill uses REST batches of up to 1,500 candles and yields between commits; aggregate rebuilds commit up to 500 buckets per batch. A checkpoint is updated only after the candle commit.

## Schema and indexes

Versioned migrations create `candles`, `backfill_jobs`, `gaps`, `system_events`, `symbol_metadata`, and `system_state`. The main indexes cover `symbol/timeframe/open_time`, source, completion status, job state, active gaps, and events by time/filter. Historical queries require symbol, timeframe, range, and limit/offset; complete histories are never loaded into the frontend.

## Maintenance and backups

The Database page and API expose DB/WAL size, PRAGMAs, integrity, and writer metrics. Manual actions run a WAL checkpoint, `PRAGMA optimize`, `ANALYZE`, and a consistent backup through `VACUUM INTO`. Regular `VACUUM` never runs during ingestion. Backups use a configurable directory and UTC filename; secrets and `.env` remain excluded.

## Limits and future migration

SQLite maintains one effective writer. PostgreSQL should be reconsidered only for multiple writer processes or hosts, high availability, replication, concurrent users with sustained writes, or a volume/retention requirement that no longer meets acceptable local latency. Any future migration is limited to the repository layer and is not part of this phase.
