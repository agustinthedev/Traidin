import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Candle } from "../domain/candle.js";
import { validateCandle } from "../domain/validate.js";
import { sqlite } from "./database.js";

type SqlRow = Record<string, unknown>;
const bool = (value: unknown) => Boolean(value);
const date = (value: unknown) => new Date(Number(value));
function mapCandle(
  r: SqlRow,
): Candle & {
  id: string;
  persistedAt: Date;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: String(r.id),
    exchange: "BINANCE",
    market: "BINANCE_USDM_FUTURES",
    symbol: String(r.symbol),
    timeframe: String(r.timeframe),
    openTime: date(r.open_time),
    closeTime: date(r.close_time),
    open: String(r.open),
    high: String(r.high),
    low: String(r.low),
    close: String(r.close),
    volume: String(r.volume),
    quoteVolume: String(r.quote_volume),
    tradeCount: Number(r.trade_count),
    takerBuyBaseVolume: String(r.taker_buy_base_volume),
    takerBuyQuoteVolume: String(r.taker_buy_quote_volume),
    firstTradeId: r.first_trade_id == null ? null : Number(r.first_trade_id),
    lastTradeId: r.last_trade_id == null ? null : Number(r.last_trade_id),
    isClosed: bool(r.is_closed),
    isComplete: bool(r.is_complete),
    source: r.source as Candle["source"],
    eventTime: r.event_time == null ? null : date(r.event_time),
    receivedAt: date(r.received_at),
    persistedAt: date(r.persisted_at),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}

const candleUpsertSql = `INSERT INTO candles (id,exchange,market,symbol,timeframe,open_time,close_time,open,high,low,close,volume,quote_volume,trade_count,taker_buy_base_volume,taker_buy_quote_volume,first_trade_id,last_trade_id,is_closed,is_complete,source,event_time,received_at,persisted_at,created_at,updated_at)
VALUES (@id,@exchange,@market,@symbol,@timeframe,@open_time,@close_time,@open,@high,@low,@close,@volume,@quote_volume,@trade_count,@taker_buy_base_volume,@taker_buy_quote_volume,@first_trade_id,@last_trade_id,@is_closed,@is_complete,@source,@event_time,@received_at,@persisted_at,@created_at,@updated_at)
ON CONFLICT(exchange,market,symbol,timeframe,open_time) DO UPDATE SET close_time=excluded.close_time,open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,quote_volume=excluded.quote_volume,trade_count=excluded.trade_count,taker_buy_base_volume=excluded.taker_buy_base_volume,taker_buy_quote_volume=excluded.taker_buy_quote_volume,first_trade_id=COALESCE(excluded.first_trade_id,candles.first_trade_id),last_trade_id=COALESCE(excluded.last_trade_id,candles.last_trade_id),is_closed=excluded.is_closed,is_complete=excluded.is_complete,source=excluded.source,event_time=COALESCE(excluded.event_time,candles.event_time),received_at=excluded.received_at,persisted_at=excluded.persisted_at,updated_at=excluded.updated_at`;
const candleParams = (c: Candle) => {
  const now = Date.now();
  return {
    id: randomUUID(),
    exchange: c.exchange,
    market: c.market,
    symbol: c.symbol,
    timeframe: c.timeframe,
    open_time: c.openTime.getTime(),
    close_time: c.closeTime.getTime(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    quote_volume: c.quoteVolume,
    trade_count: c.tradeCount,
    taker_buy_base_volume: c.takerBuyBaseVolume,
    taker_buy_quote_volume: c.takerBuyQuoteVolume,
    first_trade_id: c.firstTradeId,
    last_trade_id: c.lastTradeId,
    is_closed: Number(c.isClosed),
    is_complete: Number(c.isComplete),
    source: c.source,
    event_time: c.eventTime?.getTime() ?? null,
    received_at: c.receivedAt.getTime(),
    persisted_at: now,
    created_at: now,
    updated_at: now,
  };
};

export class CandleRepository {
  async upsertMany(items: Candle[], priority = 5) {
    if (!items.length) return { rowsAffected: 0, durationMs: 0 };
    for (const candle of items) {
      const issues = validateCandle(candle);
      if (issues.length)
        throw new Error(
          `Invalid candle ${candle.symbol} ${candle.openTime.toISOString()}: ${issues.map((i) => i.code).join(",")}`,
        );
    }
    const started = performance.now();
    const rowsAffected = await sqlite.writer.enqueue(
      priority,
      "candle-upsert",
      (db) => {
        const statement = db.prepare(candleUpsertSql);
        const transaction = db.transaction((batch: Candle[]) => {
          let changes = 0;
          for (const candle of batch)
            changes += statement.run(candleParams(candle)).changes;
          return changes;
        });
        return transaction(items);
      },
    );
    sqlite.writer.metrics.rowsAffected += rowsAffected;
    return { rowsAffected, durationMs: performance.now() - started };
  }
  range(
    symbol: string,
    timeframe: string,
    start: Date,
    end: Date,
    limit = 5000,
    offset = 0,
  ) {
    return (
      sqlite.reader
        .prepare(
          "SELECT * FROM candles WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ? ORDER BY open_time ASC LIMIT ? OFFSET ?",
        )
        .all(
          symbol,
          timeframe,
          start.getTime(),
          end.getTime(),
          limit,
          offset,
        ) as SqlRow[]
    ).map(mapCandle);
  }
  recent(symbol: string, timeframe = "1m", limit = 100, before?: Date) {
    return (
      sqlite.reader
        .prepare(before
          ? "SELECT * FROM candles WHERE symbol=? AND timeframe=? AND open_time < ? ORDER BY open_time DESC LIMIT ?"
          : "SELECT * FROM candles WHERE symbol=? AND timeframe=? ORDER BY open_time DESC LIMIT ?",
        )
        .all(...(before ? [symbol, timeframe, before.getTime(), limit] : [symbol, timeframe, limit])) as SqlRow[]
    ).map(mapCandle);
  }
  latest(symbol: string, timeframe = "1m") {
    return this.recent(symbol, timeframe, 1)[0] ?? null;
  }
  count(symbol: string, timeframe: string, start: Date, end: Date) {
    return Number(
      (
        sqlite.reader
          .prepare(
            "SELECT count(*) AS count FROM candles WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ?",
          )
          .get(symbol, timeframe, start.getTime(), end.getTime()) as {
          count: number;
        }
      ).count,
    );
  }
  coverage() {
    return sqlite.reader
      .prepare(
        "SELECT symbol,timeframe,count(*) AS count,min(open_time) AS first_open_time,max(open_time) AS last_open_time,sum(CASE WHEN is_complete=0 THEN 1 ELSE 0 END) AS incomplete FROM candles GROUP BY symbol,timeframe ORDER BY symbol,timeframe",
      )
      .all();
  }
  incompleteAggregates(limit = 250) {
    return (
      sqlite.reader
        .prepare(
          "SELECT * FROM candles WHERE timeframe <> '1m' AND is_complete=0 ORDER BY open_time ASC LIMIT ?",
        )
        .all(limit) as SqlRow[]
    ).map(mapCandle);
  }
  missingRanges(
    symbol: string,
    timeframe: string,
    start: Date,
    end: Date,
    stepMs: number,
  ) {
    const rows = sqlite.reader
      .prepare(
        "SELECT open_time,lag(open_time) OVER (ORDER BY open_time) AS previous_time FROM candles WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ? ORDER BY open_time",
      )
      .all(symbol, timeframe, start.getTime(), end.getTime()) as Array<{
      open_time: number;
      previous_time: number | null;
    }>;
    const gaps: Array<{ start: Date; end: Date; count: number }> = [];
    if (!rows.length)
      return [
        {
          start,
          end,
          count: Math.floor((end.getTime() - start.getTime()) / stepMs) + 1,
        },
      ];
    if (rows[0].open_time > start.getTime())
      gaps.push({
        start,
        end: new Date(rows[0].open_time - stepMs),
        count: Math.floor((rows[0].open_time - start.getTime()) / stepMs),
      });
    for (const row of rows)
      if (
        row.previous_time != null &&
        row.open_time - row.previous_time > stepMs
      )
        gaps.push({
          start: new Date(row.previous_time + stepMs),
          end: new Date(row.open_time - stepMs),
          count: Math.floor((row.open_time - row.previous_time) / stepMs) - 1,
        });
    const last = rows.at(-1)!.open_time;
    if (last < end.getTime())
      gaps.push({
        start: new Date(last + stepMs),
        end,
        count: Math.floor((end.getTime() - last) / stepMs),
      });
    return gaps;
  }
}
export const candleRepository = new CandleRepository();

export const eventRepository = {
  async append(event: {
    level: string;
    component: string;
    event: string;
    message: string;
    symbol?: string;
    timeframe?: string;
    jobId?: string;
    durationMs?: number;
    rowsAffected?: number;
    queueDepth?: number;
    errorCode?: string;
    details?: unknown;
  }) {
    const id = randomUUID();
    const timestamp = new Date();
    await sqlite.writer.enqueue(4, "event", (db) =>
      db
        .prepare(
          "INSERT INTO system_events(id,timestamp,level,component,event_type,symbol,timeframe,job_id,duration_ms,rows_affected,queue_depth,error_code,message,details_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          timestamp.getTime(),
          event.level,
          event.component,
          event.event,
          event.symbol ?? null,
          event.timeframe ?? null,
          event.jobId ?? null,
          event.durationMs ?? null,
          event.rowsAffected ?? null,
          event.queueDepth ?? null,
          event.errorCode ?? null,
          event.message,
          event.details === undefined ? null : JSON.stringify(event.details),
        ),
    );
    return { id, timestamp };
  },
  list(limit = 500) {
    return (
      sqlite.reader
        .prepare("SELECT * FROM system_events ORDER BY timestamp DESC LIMIT ?")
        .all(limit) as SqlRow[]
    ).map((r) => ({
      id: r.id,
      timestamp: new Date(Number(r.timestamp)),
      level: r.level,
      component: r.component,
      event: r.event_type,
      symbol: r.symbol,
      timeframe: r.timeframe,
      jobId: r.job_id,
      durationMs: r.duration_ms,
      rowsAffected: r.rows_affected,
      queueDepth: r.queue_depth,
      errorCode: r.error_code,
      message: r.message,
      details: r.details_json ? JSON.parse(String(r.details_json)) : undefined,
    }));
  },
};

export type BackfillStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";
const mapJob = (r: SqlRow) => ({
  id: String(r.id),
  market: String(r.market),
  symbol: String(r.symbol),
  timeframe: String(r.timeframe),
  startTime: date(r.start_time),
  endTime: r.end_time == null ? null : date(r.end_time),
  untilNow: bool(r.until_now),
  status: r.status as BackfillStatus,
  estimatedCandles: Number(r.estimated_candles),
  downloadedCandles: Number(r.downloaded_candles),
  persistedCandles: Number(r.persisted_candles),
  requestCount: Number(r.request_count),
  checkpointTime: r.checkpoint_time == null ? null : date(r.checkpoint_time),
  startedAt: r.started_at == null ? null : date(r.started_at),
  completedAt: r.completed_at == null ? null : date(r.completed_at),
  cancelRequested: bool(r.cancel_requested),
  errorCode: r.error_code == null ? null : String(r.error_code),
  errorMessage: r.error_message == null ? null : String(r.error_message),
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
});
export const jobRepository = {
  async create(input: {
    symbol: string;
    timeframe: string;
    startTime: Date;
    endTime?: Date;
    untilNow: boolean;
    estimatedCandles: number;
  }) {
    const id = randomUUID(),
      now = Date.now();
    await sqlite.writer.enqueue(4, "job-create", (db) =>
      db
        .prepare(
          "INSERT INTO backfill_jobs(id,symbol,timeframe,start_time,end_time,until_now,status,estimated_candles,created_at,updated_at) VALUES(?,?,?,?,?,?,'PENDING',?,?,?)",
        )
        .run(
          id,
          input.symbol,
          input.timeframe,
          input.startTime.getTime(),
          input.endTime?.getTime() ?? null,
          Number(input.untilNow),
          input.estimatedCandles,
          now,
          now,
        ),
    );
    return this.get(id)!;
  },
  list() {
    return (
      sqlite.reader
        .prepare(
          "SELECT * FROM backfill_jobs ORDER BY created_at DESC LIMIT 500",
        )
        .all() as SqlRow[]
    ).map(mapJob);
  },
  get(id: string) {
    const row = sqlite.reader
      .prepare("SELECT * FROM backfill_jobs WHERE id=?")
      .get(id) as SqlRow | undefined;
    return row ? mapJob(row) : null;
  },
  hasActive() {
    return Boolean(
      sqlite.reader
        .prepare(
          "SELECT 1 FROM backfill_jobs WHERE status IN ('PENDING','RUNNING','CANCELLING') LIMIT 1",
        )
        .get(),
    );
  },
  async update(id: string, fields: Record<string, unknown>) {
    const allowed: Record<string, string> = {
      status: "status",
      checkpointTime: "checkpoint_time",
      downloadedCandles: "downloaded_candles",
      persistedCandles: "persisted_candles",
      estimatedCandles: "estimated_candles",
      requestCount: "request_count",
      startedAt: "started_at",
      completedAt: "completed_at",
      cancelRequested: "cancel_requested",
      errorCode: "error_code",
      errorMessage: "error_message",
    };
    const entries = Object.entries(fields).filter(([key]) => allowed[key]);
    if (!entries.length) return this.get(id);
    const values = entries.map(([, value]) =>
      value instanceof Date
        ? value.getTime()
        : typeof value === "boolean"
          ? Number(value)
          : value,
    );
    const setters = entries.map(([key]) => `${allowed[key]}=?`).join(",");
    await sqlite.writer.enqueue(4, "job-update", (db) =>
      db
        .prepare(`UPDATE backfill_jobs SET ${setters},updated_at=? WHERE id=?`)
        .run(...values, Date.now(), id),
    );
    return this.get(id);
  },
  async claimNext() {
    return sqlite.writer.enqueue(4, "job-claim", (db) =>
      db.transaction(() => {
        const row = db
          .prepare(
            "SELECT * FROM backfill_jobs WHERE status='PENDING' ORDER BY created_at LIMIT 1",
          )
          .get() as SqlRow | undefined;
        if (!row) return null;
        const now = Date.now();
        db.prepare(
          "UPDATE backfill_jobs SET status='RUNNING',started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status='PENDING'",
        ).run(now, now, row.id);
        return mapJob({
          ...row,
          status: "RUNNING",
          started_at: row.started_at ?? now,
          updated_at: now,
        });
      })(),
    );
  },
  async recoverInterrupted() {
    return sqlite.writer.enqueue(
      4,
      "job-recover",
      (db) =>
        db
          .prepare(
            "UPDATE backfill_jobs SET status='PENDING',error_code='RESTART_RECOVERY',error_message='Recovered after process restart',updated_at=? WHERE status IN ('RUNNING','CANCELLING')",
          )
          .run(Date.now()).changes,
    );
  },
  async failStalled(timeoutMs: number) {
    const cutoff = Date.now() - timeoutMs;
    return sqlite.writer.enqueue(4, "job-stall-watchdog", (db) =>
      db
        .prepare(
          "UPDATE backfill_jobs SET status='FAILED',completed_at=?,error_code='BACKFILL_STALLED',error_message='No checkpoint progress within the watchdog window',updated_at=? WHERE status IN ('RUNNING','CANCELLING') AND updated_at < ?",
        )
        .run(Date.now(), Date.now(), cutoff).changes,
    );
  },
};

const mapGap = (r: SqlRow) => ({
  id: String(r.id),
  market: String(r.market),
  symbol: String(r.symbol),
  timeframe: String(r.timeframe),
  gapStart: date(r.gap_start),
  gapEnd: date(r.gap_end),
  expectedCandles: Number(r.expected_candles),
  status: String(r.status),
  detectedAt: date(r.detected_at),
  repairStartedAt:
    r.repair_started_at == null ? null : date(r.repair_started_at),
  repairedAt: r.repaired_at == null ? null : date(r.repaired_at),
  repairJobId: r.repair_job_id,
  errorMessage: r.error_message,
  downloadedCandles: Number(r.downloaded_candles ?? 0),
  persistedCandles: Number(r.persisted_candles ?? 0),
  requestCount: Number(r.request_count ?? 0),
  checkpointTime: r.checkpoint_time == null ? null : date(r.checkpoint_time),
  updatedAt: r.updated_at == null ? null : date(r.updated_at),
});
export const gapRepository = {
  async createMany(
    values: Array<{
      symbol: string;
      timeframe: string;
      gapStart: Date;
      gapEnd: Date;
      expectedCandles: number;
    }>,
  ) {
    const valid = values.filter(
      (v) => v.expectedCandles > 0 && v.gapStart <= v.gapEnd,
    );
    if (!valid.length) return 0;
    return sqlite.writer.enqueue(2, "gap-create", (db) => {
      const statement = db.prepare(
        "INSERT INTO gaps(id,symbol,timeframe,gap_start,gap_end,expected_candles,status,detected_at) VALUES(?,?,?,?,?,?,'DETECTED',?) ON CONFLICT DO NOTHING",
      );
      return db.transaction(() =>
        valid
          .map((v) =>
            statement.run(
              randomUUID(),
              v.symbol,
              v.timeframe,
              v.gapStart.getTime(),
              v.gapEnd.getTime(),
              v.expectedCandles,
              Date.now(),
            ),
          )
          .reduce((sum, result) => sum + result.changes, 0),
      )();
    });
  },
  list(activeOnly = false) {
    const sql = activeOnly
      ? "SELECT * FROM gaps WHERE status!='REPAIRED' ORDER BY detected_at DESC LIMIT 1000"
      : "SELECT * FROM gaps ORDER BY detected_at DESC LIMIT 1000";
    return (sqlite.reader.prepare(sql).all() as SqlRow[]).map(mapGap);
  },
  async update(
    id: string,
    status: "DETECTED" | "REPAIRING" | "REPAIRED" | "FAILED",
    errorMessage?: string,
  ) {
    const now = Date.now();
    await sqlite.writer.enqueue(2, "gap-update", (db) =>
      db
        .prepare(
          "UPDATE gaps SET status=?,repair_started_at=CASE WHEN ?='REPAIRING' THEN ? ELSE repair_started_at END,repaired_at=CASE WHEN ?='REPAIRED' THEN ? ELSE repaired_at END,error_message=?,updated_at=? WHERE id=?",
        )
        .run(status, status, now, status, now, errorMessage ?? null, now, id),
    );
  },
  async updateProgress(
    id: string,
    fields: {
      downloadedCandles: number;
      persistedCandles: number;
      requestCount: number;
      checkpointTime: Date;
    },
  ) {
    await sqlite.writer.enqueue(2, "gap-progress", (db) =>
      db
        .prepare(
          "UPDATE gaps SET downloaded_candles=?,persisted_candles=?,request_count=?,checkpoint_time=?,updated_at=? WHERE id=?",
        )
        .run(
          fields.downloadedCandles,
          fields.persistedCandles,
          fields.requestCount,
          fields.checkpointTime.getTime(),
          Date.now(),
          id,
        ),
    );
  },
  async recoverInterrupted() {
    return sqlite.writer.enqueue(2, "gap-recover", (db) =>
      db
        .prepare(
          "UPDATE gaps SET status='DETECTED',error_message='Recovered after process restart',updated_at=? WHERE status='REPAIRING'",
        )
        .run(Date.now()).changes,
    );
  },
  async failStalled(timeoutMs: number) {
    const now = Date.now();
    return sqlite.writer.enqueue(2, "gap-stall-watchdog", (db) =>
      db
        .prepare(
          "UPDATE gaps SET status='FAILED',error_message='No repair checkpoint progress within the watchdog window',updated_at=? WHERE status='REPAIRING' AND updated_at < ?",
        )
        .run(now, now - timeoutMs).changes,
    );
  },
  async claimNext() {
    return sqlite.writer.enqueue(2, "gap-claim", (db) =>
      db.transaction(() => {
        const row = db
          .prepare(
            "SELECT * FROM gaps WHERE status IN ('DETECTED','FAILED') ORDER BY detected_at LIMIT 1",
          )
          .get() as SqlRow | undefined;
        if (!row) return null;
        const now = Date.now();
        db.prepare(
          "UPDATE gaps SET status='REPAIRING',repair_started_at=?,error_message=NULL WHERE id=? AND status IN ('DETECTED','FAILED')",
        ).run(now, row.id);
        return mapGap({ ...row, status: "REPAIRING", repair_started_at: now });
      })(),
    );
  },
};

export const metadataRepository = {
  async upsert(values: Array<Record<string, unknown>>) {
    await sqlite.writer.enqueue(3, "metadata", (db: Database.Database) => {
      const statement = db.prepare(
        "INSERT INTO symbol_metadata(symbol,status,base_asset,quote_asset,margin_asset,contract_type,price_precision,quantity_precision,tick_size,step_size,min_qty,max_qty,min_notional,filters_json,updated_at) VALUES(@symbol,@status,@baseAsset,@quoteAsset,@marginAsset,@contractType,@pricePrecision,@quantityPrecision,@tickSize,@stepSize,@minQty,@maxQty,@minNotional,@filtersJson,@updatedAt) ON CONFLICT(symbol) DO UPDATE SET status=excluded.status,base_asset=excluded.base_asset,quote_asset=excluded.quote_asset,margin_asset=excluded.margin_asset,contract_type=excluded.contract_type,price_precision=excluded.price_precision,quantity_precision=excluded.quantity_precision,tick_size=excluded.tick_size,step_size=excluded.step_size,min_qty=excluded.min_qty,max_qty=excluded.max_qty,min_notional=excluded.min_notional,filters_json=excluded.filters_json,updated_at=excluded.updated_at",
      );
      db.transaction(() => {
        for (const value of values) statement.run(value);
      })();
    });
  },
  list() {
    return (
      sqlite.reader
        .prepare("SELECT * FROM symbol_metadata ORDER BY symbol")
        .all() as SqlRow[]
    ).map((r) => ({
      ...r,
      filters: JSON.parse(String(r.filters_json)),
      updatedAt: date(r.updated_at),
    }));
  },
};

export const systemStateRepository = {
  get<T>(key: string): T | null {
    const row = sqlite.reader
      .prepare("SELECT value_json FROM system_state WHERE key=?")
      .get(key) as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : null;
  },
  async set(key: string, value: unknown) {
    await sqlite.writer.enqueue(3, "system-state", (db) =>
      db
        .prepare(
          "INSERT INTO system_state(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        )
        .run(key, JSON.stringify(value), Date.now()),
    );
  },
};
