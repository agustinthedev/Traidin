import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const rows = Number(process.env.PERF_ROWS ?? 250_000);
const batchSize = Number(process.env.PERF_BATCH_SIZE ?? 5_000);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = resolve("data", "performance");
mkdirSync(directory, { recursive: true });
const databasePath = resolve(directory, `sqlite-${stamp}.db`);
process.env.DATABASE_URL = `sqlite:///${databasePath.replace(/\\/g, "/")}`;
process.env.START_WORKERS = "false";

const [{ candleRepository }, { sqlite }, { EXCHANGE, MARKET }] =
  await Promise.all([
    import("../server/db/repository.js"),
    import("../server/db/database.js"),
    import("../server/domain/candle.js"),
  ]);

const makeCandle = (
  index: number,
  source: "REST_BACKFILL" | "WEBSOCKET" = "REST_BACKFILL",
) => {
  const openTime = new Date(Date.UTC(2020, 0, 1) + index * 60_000);
  return {
    exchange: EXCHANGE,
    market: MARKET,
    symbol: "BTCUSDT",
    timeframe: "1m",
    openTime,
    closeTime: new Date(openTime.getTime() + 59_999),
    open: "10000.00000000",
    high: "10001.25000000",
    low: "9999.75000000",
    close: "10000.50000000",
    volume: "12.34567890",
    quoteVolume: "123462.34567890",
    tradeCount: 42,
    takerBuyBaseVolume: "6.10000000",
    takerBuyQuoteVolume: "61003.05000000",
    firstTradeId: index * 50,
    lastTradeId: index * 50 + 41,
    isClosed: true,
    isComplete: true,
    source,
    eventTime: null,
    receivedAt: new Date(),
  } as const;
};

const started = performance.now();
const durations: number[] = [];
let maxReadMs = 0,
  maxLiveMs = 0,
  dashboardChecks = 0,
  dashboardFailures = 0;
for (let offset = 0; offset < rows; offset += batchSize) {
  const size = Math.min(batchSize, rows - offset);
  const batch = Array.from({ length: size }, (_, i) => makeCandle(offset + i));
  const result = await candleRepository.upsertMany(batch, 5);
  durations.push(result.durationMs);

  const liveStarted = performance.now();
  await candleRepository.upsertMany(
    [makeCandle(rows + offset / batchSize, "WEBSOCKET")],
    1,
  );
  maxLiveMs = Math.max(maxLiveMs, performance.now() - liveStarted);

  const readStarted = performance.now();
  candleRepository.range(
    "BTCUSDT",
    "1m",
    batch[0].openTime,
    batch.at(-1)!.openTime,
    250,
  );
  maxReadMs = Math.max(maxReadMs, performance.now() - readStarted);

  try {
    const response = await fetch("http://127.0.0.1:4100/api/health", {
      signal: AbortSignal.timeout(2_000),
    });
    dashboardChecks++;
    if (!response.ok) dashboardFailures++;
  } catch {
    dashboardFailures++;
  }
}

const beforeDuplicate = candleRepository.count(
  "BTCUSDT",
  "1m",
  new Date(Date.UTC(2020, 0, 1)),
  new Date(Date.UTC(2030, 0, 1)),
);
await candleRepository.upsertMany(
  Array.from({ length: Math.min(batchSize, rows) }, (_, i) => makeCandle(i)),
  5,
);
const afterDuplicate = candleRepository.count(
  "BTCUSDT",
  "1m",
  new Date(Date.UTC(2020, 0, 1)),
  new Date(Date.UTC(2030, 0, 1)),
);
const elapsedMs = performance.now() - started;
const stats = sqlite.stats();
sqlite.close();
const sorted = [...durations].sort((a, b) => a - b);
const report = {
  databasePath,
  requestedHistoricalRows: rows,
  committedRows: beforeDuplicate,
  batchSize,
  elapsedSeconds: Number((elapsedMs / 1_000).toFixed(3)),
  throughputRowsPerSecond: Math.round(rows / (elapsedMs / 1_000)),
  bulkInsertMs: {
    average: Number(
      (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2),
    ),
    p95: Number(sorted[Math.floor(sorted.length * 0.95)]?.toFixed(2) ?? 0),
    max: Number(Math.max(...durations).toFixed(2)),
  },
  maxConcurrentReadMs: Number(maxReadMs.toFixed(2)),
  maxSimulatedLiveWriteMs: Number(maxLiveMs.toFixed(2)),
  dashboardHealth: { checks: dashboardChecks, failures: dashboardFailures },
  idempotency: {
    countBeforeReplay: beforeDuplicate,
    countAfterReplay: afterDuplicate,
    duplicateRowsAdded: afterDuplicate - beforeDuplicate,
  },
  sqlite: {
    journalMode: stats.journalMode,
    busyRetries: stats.writer.busyRetries,
    maxQueueDepth: stats.writer.maxQueueDepth,
  },
  fileBytes: statSync(databasePath).size,
  walBytesAtClose: stats.walBytes,
};
console.log(JSON.stringify(report, null, 2));
