"use client";
import { FormEvent, useState } from "react";
import {
  API,
  AnyRow,
  Empty,
  Metric,
  PageHead,
  StatusDot,
  apiJson,
  bytes,
  fmtDate,
  fmtNum,
  fmtTime,
  localInput,
} from "./ui";

const CANDLE_PAGE_SIZE = 100;
type HistoricalRange = { symbol: string; timeframe: string; start: string; end: string };

export function Historical({ symbols }: { symbols: string[] }) {
  const [symbolValue, setSymbol] = useState(symbols[0] ?? "BTCUSDT");
  const [tf, setTf] = useState("1m");
  const [start, setStart] = useState(() => localInput(Date.now() - 86_400_000));
  const [end, setEnd] = useState(() => localInput(Date.now()));
  const [data, setData] = useState<AnyRow | null>(null);
  const [activeRange, setActiveRange] = useState<HistoricalRange | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(CANDLE_PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const queryString = (range: HistoricalRange, limit: number, offset = 0) => new URLSearchParams({ symbol: range.symbol, timeframe: range.timeframe, start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString(), limit: String(limit), offset: String(offset) }).toString();
  async function loadPage(range: HistoricalRange, nextPage: number, nextPageSize = pageSize) {
    setBusy(true);
    try {
      setData(await apiJson(`/api/candles?${queryString(range, nextPageSize, nextPage * nextPageSize)}`));
      setActiveRange(range);
      setPage(nextPage);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) { e.preventDefault(); void loadPage({ symbol: symbolValue, timeframe: tf, start, end }, 0); }
  function downloadCsv() {
    const range = { symbol: symbolValue, timeframe: tf, start, end };
    const link = document.createElement("a");
    link.href = `${API}/api/candles.csv?${queryString(range, 0)}`;
    link.download = `candles-${range.symbol}-${range.timeframe}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  const totalPages = data ? Math.max(1, Math.ceil(Number(data.total) / pageSize)) : 0;
  const firstRow = data?.total ? Number(data.offset) + 1 : 0;
  const lastRow = data ? Math.min(Number(data.offset) + data.rows.length, Number(data.total)) : 0;
  return (
    <>
      <PageHead eyebrow="DATA / EXPLORER" title="Historical Data" />
      <form className="query-bar" onSubmit={submit}>
        <label>
          SYMBOL
          <select
            value={symbolValue}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          TIMEFRAME
          <select value={tf} onChange={(e) => setTf(e.target.value)}>
            {["1m", "5m", "15m", "1h", "4h", "1d", "1w"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          FROM
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          TO
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <button disabled={busy}>{busy ? "QUERYING…" : "RUN QUERY"}</button>
        <button type="button" onClick={downloadCsv}>DOWNLOAD CSV</button>
      </form>
      {data ? (
        <>
          <div className="result-line">
            <span>{fmtNum(data.total, 0)} RECORDS</span>
            <span>SHOWING {firstRow}–{lastRow} OF {fmtNum(data.total, 0)}</span>
            <span>
              {symbolValue} / {tf}
            </span>
          </div>
          <CandleTable rows={data.rows} />
          <div className="table-pagination" aria-label="Historical data pagination">
            <label>
              ROWS PER PAGE
              <select value={pageSize} onChange={(event) => { const nextPageSize = Number(event.target.value); setPageSize(nextPageSize); if (activeRange) void loadPage(activeRange, 0, nextPageSize); }}>
                {[25, 50, 100, 250, 500].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || page === 0 || !activeRange} onClick={() => activeRange && void loadPage(activeRange, page - 1)}>PREVIOUS</button>
            <span>PAGE {page + 1} / {totalPages}</span>
            <button type="button" disabled={busy || page + 1 >= totalPages || !activeRange} onClick={() => activeRange && void loadPage(activeRange, page + 1)}>NEXT</button>
          </div>
        </>
      ) : (
        <Empty text="Select a range to inspect normalized candles." />
      )}
    </>
  );
}
function CandleTable({ rows }: { rows: AnyRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>OPEN TIME</th>
            <th>OPEN</th>
            <th>HIGH</th>
            <th>LOW</th>
            <th>CLOSE</th>
            <th>VOLUME</th>
            <th>TRADES</th>
            <th>SOURCE</th>
            <th>STATE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{fmtDate(r.openTime)}</td>
              <td>{r.open}</td>
              <td>{r.high}</td>
              <td>{r.low}</td>
              <td>{r.close}</td>
              <td>{fmtNum(r.volume, 4)}</td>
              <td>{fmtNum(r.tradeCount, 0)}</td>
              <td>
                <code>{r.source}</code>
              </td>
              <td>
                <span className={`tag ${r.isComplete ? "ok" : "warn"}`}>
                  {r.isComplete ? "COMPLETE" : "INCOMPLETE"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Backfills({
  jobs,
  symbols,
  refresh,
}: {
  jobs: AnyRow[];
  symbols: string[];
  refresh: () => Promise<void>;
}) {
  const [symbolValue, setSymbol] = useState(symbols[0] ?? "BTCUSDT");
  const [start, setStart] = useState(() => localInput(Date.now() - 30 * 86_400_000));
  const [end, setEnd] = useState(() => localInput(Date.now()));
  const [untilNow, setUntilNow] = useState(true);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await apiJson("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        symbol: symbolValue,
        timeframe: "1m",
        startTime: new Date(start).toISOString(),
        endTime: untilNow ? undefined : new Date(end).toISOString(),
        untilNow,
      }),
    });
    await refresh();
  }
  const action = async (id: string, name: string) => {
    await apiJson(`/api/jobs/${id}/${name}`, { method: "POST" });
    await refresh();
  };
  return (
    <>
      <PageHead eyebrow="HISTORICAL / JOBS" title="Backfill Jobs" />
      <form className="query-bar" onSubmit={submit}>
        <label>
          SYMBOL
          <select
            value={symbolValue}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          TIMEFRAME
          <select>
            <option>1m</option>
          </select>
        </label>
        <label>
          FROM
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className={untilNow ? "disabled" : ""}>
          TO
          <input
            disabled={untilNow}
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={untilNow}
            onChange={(e) => setUntilNow(e.target.checked)}
          />
          UNTIL NOW
        </label>
        <button>CREATE JOB</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>JOB / SYMBOL</th>
              <th>RANGE</th>
              <th>STATUS</th>
              <th>PROGRESS</th>
              <th>DOWNLOADED</th>
              <th>REQUESTS</th>
              <th>UPDATED</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const progress =
                j.status === "COMPLETED"
                  ? 100
                  : j.estimatedCandles
                    ? Math.min(
                        100,
                        (j.persistedCandles / j.estimatedCandles) * 100,
                      )
                    : 0;
              return (
                <tr key={j.id}>
                  <td>
                    <strong>{j.symbol}</strong>
                    <small className="block">
                      {j.id.slice(0, 8)} / {j.timeframe}
                    </small>
                  </td>
                  <td>
                    {fmtDate(j.startTime)}
                    <small className="block">
                      → {j.untilNow ? "NOW" : fmtDate(j.endTime)}
                    </small>
                  </td>
                  <td>
                    <span className={`tag ${j.status.toLowerCase()}`}>
                      {j.status}
                    </span>
                  </td>
                  <td>
                    <div className="progress">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <small>{progress.toFixed(1)}%</small>
                  </td>
                  <td>
                    {fmtNum(j.persistedCandles, 0)} /{" "}
                    {fmtNum(j.estimatedCandles, 0)}
                  </td>
                  <td>{j.requestCount}</td>
                  <td>{fmtTime(j.updatedAt)}</td>
                  <td className="actions">
                    {j.status === "RUNNING" && (
                      <div className="job-actions">
                        <button
                          className="job-action pause"
                          onClick={() => void action(j.id, "pause")}
                        >
                          PAUSE
                        </button>
                        <button
                          className="job-action cancel"
                          onClick={() => void action(j.id, "cancel")}
                        >
                          CANCEL
                        </button>
                      </div>
                    )}
                    {["FAILED", "PAUSED", "CANCELLED"].includes(j.status) && (
                      <div className="job-actions">
                        <button
                          className="job-action retry"
                          onClick={() => void action(j.id, "retry")}
                        >
                          RETRY
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Quality({
  gaps,
  coverage,
  refresh,
  scanIntervalMs,
}: {
  gaps: AnyRow[];
  coverage: AnyRow[];
  refresh: () => Promise<void>;
  scanIntervalMs?: number;
}) {
  return (
    <>
      <PageHead
        eyebrow="INTEGRITY / COVERAGE"
        title="Data Quality"
        aside={
          <button
            className="primary"
            onClick={async () => {
              await Promise.all(
                coverage
                  .filter((c) => c.first_open_time)
                  .map((c) =>
                    apiJson("/api/gaps/scan", {
                      method: "POST",
                      body: JSON.stringify({
                        symbol: c.symbol,
                        timeframe: c.timeframe,
                        start: new Date(c.first_open_time).toISOString(),
                        end: new Date(c.last_open_time).toISOString(),
                      }),
                    }),
                  ),
              );
              await apiJson("/api/aggregations/reconcile", { method: "POST" });
              await refresh();
            }}
          >
            SCAN ALL
          </button>
        }
      />
      <div className="coverage-grid">
        {coverage.map((c) => (
          <div className="coverage" key={`${c.symbol}${c.timeframe}`}>
            <div>
              <strong>{c.symbol}</strong>
              <span>{c.timeframe}</span>
            </div>
            <b>{fmtNum(c.count, 0)}</b>
            <div className="coverage-bar">
              <i style={{ width: c.incomplete ? "85%" : "100%" }} />
            </div>
            <small>
              {fmtDate(c.first_open_time)} → {fmtDate(c.last_open_time)}
            </small>
            <span className={`tag ${c.incomplete ? "warn" : "ok"}`}>
              {c.incomplete ? `${c.incomplete} INCOMPLETE` : "COMPLETE"}
            </span>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <span>GAP REGISTER</span>
          <small>AUTO-SCAN · EVERY {Math.max(1, Math.round((scanIntervalMs ?? 300_000) / 60_000))} MIN</small>
          <button
            onClick={async () => {
              await apiJson("/api/gaps/repair", { method: "POST" });
              await refresh();
            }}
          >
            REPAIR NEXT
          </button>
        </div>
        <div className="table-wrap bare">
          <table>
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>TIMEFRAME</th>
                <th>START</th>
                <th>END</th>
                <th>MISSING</th>
                <th>PROGRESS</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
                <th>DETECTED</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => {
                const persisted = Number(g.persistedCandles ?? 0);
                const expected = Number(g.expectedCandles ?? 0);
                const progress =
                  g.status === "REPAIRED"
                    ? 100
                    : expected
                      ? Math.min(100, (persisted / expected) * 100)
                      : 0;
                return (
                <tr key={g.id}>
                  <td>{g.symbol}</td>
                  <td>{g.timeframe}</td>
                  <td>{fmtDate(g.gapStart)}</td>
                  <td>{fmtDate(g.gapEnd)}</td>
                  <td>{g.expectedCandles}</td>
                  <td className="gap-progress">
                    <div className="progress">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <small>
                      {fmtNum(persisted, 0)} / {fmtNum(expected, 0)} ({progress.toFixed(1)}%)
                    </small>
                  </td>
                  <td>
                    <span
                      className={`tag ${g.status === "REPAIRED" ? "ok" : "warn"}`}
                    >
                      {g.status}
                    </span>
                  </td>
                  <td className="actions">
                    {g.status === "FAILED" && (
                      <button
                        className="job-action retry"
                        onClick={async () => {
                          await apiJson("/api/gaps/repair", { method: "POST" });
                          await refresh();
                        }}
                      >
                        RETRY
                      </button>
                    )}
                  </td>
                  <td>{fmtDate(g.detectedAt)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function Symbols({
  rows,
  refresh,
}: {
  rows: AnyRow[];
  refresh: () => Promise<void>;
}) {
  return (
    <>
      <PageHead
        eyebrow="EXCHANGE / CONTRACTS"
        title="Symbols"
        aside={
          <button
            className="primary"
            onClick={async () => {
              await apiJson("/api/metadata/refresh", { method: "POST" });
              await refresh();
            }}
          >
            REFRESH BINANCE
          </button>
        }
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SYMBOL</th>
              <th>STATE</th>
              <th>CONTRACT</th>
              <th>BASE / QUOTE</th>
              <th>MARGIN</th>
              <th>TICK SIZE</th>
              <th>STEP SIZE</th>
              <th>MIN QTY</th>
              <th>MIN NOTIONAL</th>
              <th>UPDATED</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td>
                  <strong>{r.symbol}</strong>
                </td>
                <td>
                  <span className="tag ok">{r.status}</span>
                </td>
                <td>{r.contract_type}</td>
                <td>
                  {r.base_asset} / {r.quote_asset}
                </td>
                <td>{r.margin_asset}</td>
                <td>{r.tick_size}</td>
                <td>{r.step_size}</td>
                <td>{r.min_qty}</td>
                <td>{r.min_notional}</td>
                <td>{fmtDate(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DatabasePanel({
  database,
  refresh,
}: {
  database?: AnyRow;
  refresh: () => Promise<void>;
}) {
  const action = async (name: string) => {
    await apiJson(`/api/database/${name}`, { method: "POST" });
    await refresh();
  };
  return (
    <>
      <PageHead
        eyebrow="STORAGE / SQLITE"
        title="Database"
        aside={
          <div className="button-row">
            <button onClick={() => void action("checkpoint")}>
              WAL CHECKPOINT
            </button>
            <button onClick={() => void action("optimize")}>OPTIMIZE</button>
            <button className="primary" onClick={() => void action("backup")}>
              CREATE BACKUP
            </button>
          </div>
        }
      />
      <div className="metric-grid database">
        <Metric
          label="DATA STORE"
          value="SQLITE · WAL"
          tone={database?.integrity === "ok" ? "positive" : "negative"}
          detail={database?.path ?? "local"}
        />
        <Metric
          label="JOURNAL MODE"
          value={String(database?.journalMode ?? "—").toUpperCase()}
          tone="cyan"
          detail="concurrent readers"
        />
        <Metric
          label="DATABASE SIZE"
          value={bytes(database?.databaseBytes ?? 0)}
          detail={`${fmtNum(database?.counts?.candles, 0)} candles`}
        />
        <Metric
          label="WAL SIZE"
          value={bytes(database?.walBytes ?? 0)}
          detail="passive checkpoints"
        />
        <Metric
          label="BUSY TIMEOUT"
          value={`${database?.busyTimeout ?? 0} ms`}
          detail={`${database?.writer?.busyRetries ?? 0} retries`}
        />
        <Metric
          label="WRITER QUEUE"
          value={database?.writer?.queueDepth ?? 0}
          tone={
            (database?.writer?.queueDepth ?? 0) > 20 ? "warning" : "positive"
          }
          detail={database?.writer?.active ? "active" : "idle"}
        />
        <Metric
          label="AVG BULK WRITE"
          value={`${fmtNum(database?.writer?.averageDurationMs, 2)} ms`}
          detail={`${fmtNum(database?.writer?.completedWrites, 0)} operations`}
        />
        <Metric
          label="LAST WRITE"
          value={fmtTime(database?.lastCandleWriteAt)}
          detail={`${fmtNum(database?.writer?.rowsAffected, 0)} affected`}
        />
      </div>
      <section className="panel">
        <div className="panel-title">
          <span>STORAGE INVENTORY</span>
          <small>LOCAL / NO EXTERNAL SERVICES</small>
        </div>
        <div className="inventory">
          {Object.entries(database?.counts ?? {}).map(([key, value]) => (
            <div key={key}>
              <span>{key.replaceAll("_", " ").toUpperCase()}</span>
              <strong>{fmtNum(value, 0)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="notice">
        <strong>WRITE COORDINATION</strong>
        <p>
          All producers enter a single priority queue. Live candles use priority
          1, gap repair 2, metadata 3, backfill 5 and aggregate rebuilds 6.
          Transactions remain batch-scoped and yield between batches.
        </p>
      </section>
    </>
  );
}

export function Settings({
  config,
  health,
}: {
  config?: AnyRow;
  health?: AnyRow;
}) {
  const [symbols, setSymbols] = useState((config?.symbols ?? []).join(", "));
  const [frames, setFrames] = useState(
    (config?.aggregatedTimeframes ?? []).join(", "),
  );
  const [retention, setRetention] = useState(config?.eventRetentionDays ?? 30);
  const [streams, setStreams] = useState(config?.streamsEnabled ?? true);
  const [notice, setNotice] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    const result = await apiJson("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        symbols: symbols
          .split(",")
          .map((v: string) => v.trim().toUpperCase())
          .filter(Boolean),
        aggregatedTimeframes: frames
          .split(",")
          .map((v: string) => v.trim())
          .filter(Boolean),
        eventRetentionDays: Number(retention),
        streamsEnabled: streams,
      }),
    });
    setNotice(
      result.restartRequired ? "SAVED / RESTART BACKEND TO APPLY" : "SAVED",
    );
  }
  return (
    <>
      <PageHead eyebrow="SYSTEM / CONFIGURATION" title="Settings" />
      <div className="settings-grid">
        <form className="panel settings-form" onSubmit={save}>
          <div className="panel-title">
            <span>MARKET DATA</span>
            <small>LOCAL RUNTIME</small>
          </div>
          <label>
            Enabled symbols
            <input
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
            />
          </label>
          <label>
            Aggregated timeframes
            <input value={frames} onChange={(e) => setFrames(e.target.value)} />
          </label>
          <label>
            Event retention days
            <input
              type="number"
              min="1"
              max="3650"
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
            />
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={streams}
              onChange={(e) => setStreams(e.target.checked)}
            />{" "}
            Enable streams and workers
          </label>
          <button className="primary">SAVE SETTINGS</button>
          {notice && <small className="settings-notice">{notice}</small>}
          <dl>
            <dt>Canonical timeframe</dt>
            <dd>1m closed candles</dd>
            <dt>REST endpoint</dt>
            <dd>{config?.restUrl}</dd>
            <dt>WebSocket endpoint</dt>
            <dd>{config?.wsUrl}</dd>
            <dt>SQLite batch size</dt>
            <dd>{fmtNum(config?.sqliteBatchSize, 0)} / ENV</dd>
          </dl>
        </form>
        <section className="panel">
          <div className="panel-title">
            <span>CREDENTIAL SAFETY</span>
            <small>BACKEND ONLY</small>
          </div>
          <dl>
            <dt>API key configured</dt>
            <dd>
              <span
                className={`tag ${config?.credentials?.apiKeyConfigured ? "ok" : "muted"}`}
              >
                {config?.credentials?.apiKeyConfigured ? "YES" : "NO"}
              </span>
            </dd>
            <dt>API secret configured</dt>
            <dd>
              <span
                className={`tag ${config?.credentials?.apiSecretConfigured ? "ok" : "muted"}`}
              >
                {config?.credentials?.apiSecretConfigured ? "YES" : "NO"}
              </span>
            </dd>
            <dt>Read access validation</dt>
            <dd>NOT CHECKED</dd>
            <dt>Futures access validation</dt>
            <dd>NOT CHECKED</dd>
            <dt>Secret exposure</dt>
            <dd>
              <span className="tag ok">BLOCKED</span>
            </dd>
          </dl>
        </section>
        <section className="panel health-list">
          <div className="panel-title">
            <span>COMPONENT HEALTH</span>
          </div>
          {Object.entries(health?.components ?? {}).map(([name, state]) => (
            <div key={name}>
              <StatusDot state={String(state)} />
              <span>{name.replace(/([A-Z])/g, " $1")}</span>
              <strong>{String(state)}</strong>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
