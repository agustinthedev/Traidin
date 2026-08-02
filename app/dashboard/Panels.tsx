"use client";
import { FormEvent, useState } from "react";
import {
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

export function Historical({ symbols }: { symbols: string[] }) {
  const [symbolValue, setSymbol] = useState(symbols[0] ?? "BTCUSDT");
  const [tf, setTf] = useState("1m");
  const [start, setStart] = useState(() => localInput(Date.now() - 86_400_000));
  const [end, setEnd] = useState(() => localInput(Date.now()));
  const [data, setData] = useState<AnyRow | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setData(
        await apiJson(
          `/api/candles?symbol=${symbolValue}&timeframe=${tf}&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}&limit=500`,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
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
      </form>
      {data ? (
        <>
          <div className="result-line">
            <span>{fmtNum(data.total, 0)} RECORDS</span>
            <span>SHOWING {data.rows.length}</span>
            <span>
              {symbolValue} / {tf}
            </span>
          </div>
          <CandleTable rows={data.rows} />
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
}: {
  gaps: AnyRow[];
  coverage: AnyRow[];
  refresh: () => Promise<void>;
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
                <th>STATUS</th>
                <th>DETECTED</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.id}>
                  <td>{g.symbol}</td>
                  <td>{g.timeframe}</td>
                  <td>{fmtDate(g.gapStart)}</td>
                  <td>{fmtDate(g.gapEnd)}</td>
                  <td>{g.expectedCandles}</td>
                  <td>
                    <span
                      className={`tag ${g.status === "REPAIRED" ? "ok" : "warn"}`}
                    >
                      {g.status}
                    </span>
                  </td>
                  <td>{fmtDate(g.detectedAt)}</td>
                </tr>
              ))}
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
          label="CONNECTION"
          value={database?.integrity === "ok" ? "HEALTHY" : "ERROR"}
          tone="positive"
          detail={database?.path}
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
