# Architecture

The system is a local TypeScript application with two processes: a Fastify backend on port 4100 and a Vinext/React dashboard. No container or infrastructure service is required.

```text
Binance public REST + USD-M Futures WebSocket
                    |
             Binance adapter
              /           \
    live ingestion      backfill / gap repair
              \           /
              validation + normalized Candle
                         |
        priority persistence coordinator
                         |
                 SQLite writer (WAL)
                         |
           repositories + aggregation engine
                         |
             Fastify API + SSE + metrics
                         |
                 operations dashboard
```

The adapter is the only module aware of Binance payload formats. Domain code receives typed candles. `CandleRepository`, job, gap, event, metadata and system-state repositories isolate SQLite statements. The canonical source is complete, closed 1m data; aggregate buckets are reproducible from it.

Live updates are held in memory until Binance marks them closed. Backfills commit chronological REST batches and advance their checkpoint after commit. Gap repair has a higher writer priority, deduplicates ranges and recalculates affected incomplete aggregates. The internal event bus drives SSE immediately and persists important events through the same writer.

On startup the backend validates environment configuration, creates the data directory, applies migrations/PRAGMAs, restores dashboard settings and interrupted jobs, refreshes exchange metadata, checks recent continuity and then starts one combined stream. Health remains syncing/degraded until the WebSocket and continuity checks are healthy.

The dashboard exposes nine operational views and never receives secrets. It uses bounded historical queries and SSE for live console activity. Maintenance actions are explicit and limited to checkpoint, optimize and consistent backup; there is no arbitrary SQL console.
