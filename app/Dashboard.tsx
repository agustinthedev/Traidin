"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  API,
  AnyRow,
  Metric,
  PageHead,
  StatusDot,
  apiJson,
  bytes,
  fmtNum,
  fmtTime,
} from "./dashboard/ui";
import {
  Backfills,
  DatabasePanel,
  Historical,
  Quality,
  Symbols,
} from "./dashboard/Panels";
import Settings from "./dashboard/SettingsCompat";
import CandlestickChart from "./dashboard/CandlestickChart";
import StrategyVerification from "./dashboard/StrategyVerification";
import { ToastViewport } from "./dashboard/toast";

type Tab = "Overview" | "Live Market" | "Historical Data" | "Backfill Jobs" | "Data Quality" | "Symbols" | "Database" | "System Events" | "Settings" | "Strategies" | "Strategy Verifier";

const NAV_GROUPS: Array<{ label: string; items: readonly Tab[] }> = [
  { label: "Workspace", items: ["Overview"] },
  { label: "Market data", items: ["Live Market", "Historical Data", "Data Quality", "Symbols"] },
  { label: "Research", items: ["Strategies", "Strategy Verifier"] },
  { label: "Operations", items: ["Backfill Jobs", "Database", "System Events"] },
  { label: "System", items: ["Settings"] },
];

function NavIcon({ name }: { name: Tab }) {
  const glyphs: Record<Tab, string> = {
    Overview: "⌂", "Live Market": "↗", "Historical Data": "◫", "Backfill Jobs": "◌", "Data Quality": "✓", Symbols: "◇", Database: "▣", "System Events": "≋", Settings: "⚙", Strategies: "⌘", "Strategy Verifier": "◈",
  };
  return <span className="nav-icon" aria-hidden="true">{glyphs[name]}</span>;
}
export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [status, setStatus] = useState<AnyRow | null>(null);
  const [health, setHealth] = useState<AnyRow | null>(null);
  const [events, setEvents] = useState<AnyRow[]>([]);
  const [jobs, setJobs] = useState<AnyRow[]>([]);
  const [gaps, setGaps] = useState<AnyRow[]>([]);
  const [metadata, setMetadata] = useState<AnyRow[]>([]);
  const [coverage, setCoverage] = useState<AnyRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [utcClock, setUtcClock] = useState("--:--:--");
  const refresh = useCallback(async () => {
    try {
      const [s, h, j, g, m, c] = await Promise.all([
        apiJson("/api/status"),
        apiJson("/api/health"),
        apiJson("/api/jobs"),
        apiJson("/api/gaps"),
        apiJson("/api/metadata"),
        apiJson("/api/coverage"),
      ]);
      setStatus(s);
      setHealth(h);
      setJobs(j);
      setGaps(g);
      setMetadata(m);
      setCoverage(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend unavailable");
    }
  }, []);
  useEffect(() => {
    const clock = setInterval(
      () => setUtcClock(new Date().toISOString().slice(11, 19)),
      1000,
    );
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    void apiJson("/api/events?limit=300")
      .then((rows) => setEvents(rows.reverse()))
      .catch(() => {});
    const poll = setInterval(() => void refresh(), 3000);
    const source = new EventSource(`${API}/api/events/stream`);
    source.addEventListener("market-event", (message) => {
      const event = JSON.parse((message as MessageEvent).data);
      setEvents((old) => [...old.slice(-999), event]);
    });
    source.onerror = () => setError("Realtime event stream reconnecting");
    return () => {
      clearInterval(poll);
      source.close();
    };
  }, [refresh]);
  const activeJobs = jobs.filter((j) =>
    ["PENDING", "RUNNING", "CANCELLING"].includes(j.status),
  ).length;
  const activeGaps = gaps.filter((g) =>
    ["DETECTED", "REPAIRING"].includes(g.status),
  ).length;
  return (
    <main className={`terminal-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <ToastViewport />
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/treidin-mark.png" alt="Treidin" />
          <div>
            <strong>TREIDIN</strong>
            <small>MARKET DATA / USDⓈ-M</small>
          </div>
        </div>
        <div className="top-status">
          <span className="environment-badge">LOCAL</span>
          <span className="health-summary"><StatusDot state={health?.status ?? "STARTING"} /> {health?.status ?? "STARTING"}</span>
          <span className="divider" />
          <span>UTC {utcClock}</span>
          <span className="divider" />
          <span>{status?.symbols?.length ?? 0} STREAMS</span>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="Primary navigation">
          <button className="sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((value) => !value)} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
            <span aria-hidden="true">☰</span><em>Collapse menu</em>
          </button>
          <nav>
            {NAV_GROUPS.map((group) => (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map((item) => (
                  <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)} aria-current={tab === item ? "page" : undefined} title={sidebarCollapsed ? item : undefined}>
                    <NavIcon name={item} />
                    <span className="nav-label">{item}</span>
                    {item === "Backfill Jobs" && activeJobs > 0 && <b>{activeJobs}</b>}
                    {item === "Data Quality" && activeGaps > 0 && <b className="warn-badge">{activeGaps}</b>}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-foot">
            <span>DATA STORE</span>
            <strong>SQLITE · WAL</strong>
            <small>{status?.database?.path ?? "local"}</small>
          </div>
        </aside>
        <section className="content">
          {error && (
            <div className="error-strip">
              <strong>CONNECTION</strong>
              {error}
              <button onClick={() => void refresh()}>RETRY</button>
            </div>
          )}
          {tab === "Overview" && (
            <Overview
              status={status}
              health={health}
              jobs={jobs}
              gaps={gaps}
              events={events}
            />
          )}
          {tab === "Live Market" && <LiveMarket status={status} />}
          {tab === "Historical Data" && (
            <Historical
              symbols={status?.config?.symbols ?? ["BTCUSDT", "ETHUSDT"]}
            />
          )}
          {tab === "Backfill Jobs" && (
            <Backfills
              jobs={jobs}
              symbols={status?.config?.symbols ?? []}
              refresh={refresh}
            />
          )}
          {tab === "Data Quality" && (
            <Quality
              gaps={gaps}
              coverage={coverage}
              refresh={refresh}
              scanIntervalMs={Number(status?.config?.dataQualityScanIntervalMs) || 300_000}
            />
          )}
          {tab === "Symbols" && <Symbols rows={metadata} refresh={refresh} />}
          {tab === "Database" && (
            <DatabasePanel database={status?.database} refresh={refresh} />
          )}
          {tab === "System Events" && <EventConsole events={events} full />}
          {tab === "Settings" && (
            <Settings config={status?.config} health={health} />
          )}
          {tab === "Strategies" && <StrategyVerification mode="builder" symbols={status?.config?.symbols ?? []} refreshShell={refresh} />}
          {tab === "Strategy Verifier" && <StrategyVerification mode="verifier" symbols={status?.config?.symbols ?? []} refreshShell={refresh} />}
        </section>
      </div>
    </main>
  );
}

function Overview({
  status,
  health,
  jobs,
  gaps,
  events,
}: {
  status: AnyRow | null;
  health: AnyRow | null;
  jobs: AnyRow[];
  gaps: AnyRow[];
  events: AnyRow[];
}) {
  const db = status?.database;
  const symbols = status?.symbols ?? [];
  const activeGapCount = gaps.filter((g) =>
    ["DETECTED", "REPAIRING"].includes(g.status),
  ).length;
  const failedGapCount = gaps.filter((g) => g.status === "FAILED").length;
  return (
    <>
      <PageHead
        eyebrow="OPERATIONS / OVERVIEW"
        title="Market Data Control"
        aside={
          <div className="headline-state">
            <StatusDot state={health?.status ?? "STARTING"} />
            <div>
              <small>SYSTEM STATE</small>
              <strong>{health?.status ?? "STARTING"}</strong>
            </div>
          </div>
        }
      />
      <div className="metric-grid">
        <Metric
          label="WEBSOCKET"
          value={
            status?.websocketConnected
              ? status?.websocketFresh
                ? "CONNECTED"
                : "STALE"
              : "OFFLINE"
          }
          tone={
            !status?.websocketConnected
              ? "negative"
              : status?.websocketFresh
                ? "positive"
                : "warning"
          }
          detail={`${fmtNum(status?.messages, 0)} messages`}
        />
        <Metric
          label="BINANCE REST"
          value={status?.restHealthy ? "ONLINE" : "OFFLINE"}
          tone={status?.restHealthy ? "positive" : "negative"}
        />
        <Metric
          label="CANDLES / DB"
          value={fmtNum(db?.counts?.candles, 0)}
          detail={`${fmtNum(status?.persisted, 0)} live session`}
        />
        <Metric
          label="AGGREGATED"
          value={fmtNum(status?.aggregated, 0)}
          detail="local timeframes"
        />
        <Metric
          label="ACTIVE GAPS"
          value={activeGapCount}
          tone={
            activeGapCount > 0 ? "warning" : "positive"
          }
          detail={`${failedGapCount} failed / ${fmtNum(status?.repairedGaps, 0)} repaired`}
        />
        <Metric
          label="ACTIVE JOBS"
          value={jobs.filter((j) => j.status === "RUNNING").length}
          detail={`${jobs.filter((j) => j.status === "FAILED").length} failed`}
        />
        <Metric
          label="SQLITE WRITER"
          value={db?.writer?.active ? "WRITING" : "IDLE"}
          detail={`queue ${db?.writer?.queueDepth ?? 0}`}
        />
        <Metric
          label="UPTIME"
          value={`${fmtNum((status?.uptimeSeconds ?? 0) / 3600)}h`}
          detail={`WAL ${bytes(db?.walBytes ?? 0)}`}
        />
      </div>
      <section className="panel stream-strip">
        <div className="panel-title">
          <span>LIVE STREAMS</span>
          <small>OPEN 1-MINUTE CANDLES</small>
        </div>
        <div className="stream-row">
          {symbols.map((s: AnyRow) => (
            <div className="stream-cell" key={s.symbol}>
              <div>
                <StatusDot state={s.state} />
                <strong>{s.symbol}</strong>
                <small>{s.state}</small>
              </div>
              <b>{s.openCandle?.close ?? s.lastClosedCandle?.close ?? "—"}</b>
              <span>O {s.openCandle?.open ?? "—"}</span>
              <span>H {s.openCandle?.high ?? "—"}</span>
              <span>L {s.openCandle?.low ?? "—"}</span>
              <span>{fmtNum(s.latencyMs, 0)} ms</span>
            </div>
          ))}
        </div>
      </section>
      <EventConsole events={events} />
    </>
  );
}
function LiveMarket({ status }: { status: AnyRow | null }) {
  return (
    <>
      <PageHead
        eyebrow="MARKET / REALTIME"
        title="Live Market"
        aside={
          <span className="live-pill">
            <i /> LIVE / 1m
          </span>
        }
      />
      <div className="live-grid">
        {(status?.symbols ?? []).map((s: AnyRow) => (
          <section className="symbol-panel" key={s.symbol}>
            <div className="symbol-head">
              <div>
                <StatusDot state={s.state} />
                <h2>{s.symbol}</h2>
                <small>PERPETUAL</small>
              </div>
              <div className="price">
                <strong>
                  {s.openCandle?.close ?? s.lastClosedCandle?.close ?? "—"}
                </strong>
                <span>USDT</span>
              </div>
            </div>
            <div className="ohlc">
              <Metric label="OPEN" value={s.openCandle?.open ?? "—"} />
              <Metric label="HIGH" value={s.openCandle?.high ?? "—"} />
              <Metric label="LOW" value={s.openCandle?.low ?? "—"} />
              <Metric
                label="LIVE CLOSE"
                value={s.openCandle?.close ?? "—"}
                tone="cyan"
              />
            </div>
            <CandlestickChart symbol={s.symbol} liveCandle={s.openCandle} />
            <div className="symbol-foot">
              <span>
                VOL <b>{fmtNum(s.openCandle?.volume, 3)}</b>
              </span>
              <span>
                TRADES <b>{fmtNum(s.openCandle?.tradeCount, 0)}</b>
              </span>
              <span>
                LATENCY <b>{fmtNum(s.latencyMs, 0)} ms</b>
              </span>
              <span>
                LAST MSG <b>{fmtTime(s.lastMessageAt)}</b>
              </span>
            </div>
            <div className="open-flag">
              OPEN CANDLE — NOT PERSISTED AS FINAL
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
export function EventConsole({
  events,
  full = false,
}: {
  events: AnyRow[];
  full?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [auto, setAuto] = useState(true);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("ALL");
  const [clearedAt, setClearedAt] = useState(0);
  const consoleBody = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () =>
      events
        .slice(clearedAt)
        .filter(
          (e) =>
            (level === "ALL" || e.level === level) &&
            (!query ||
              JSON.stringify(e).toLowerCase().includes(query.toLowerCase())),
        ),
    [events, level, query, clearedAt],
  );
  useEffect(() => {
    if (auto && !paused && consoleBody.current) {
      consoleBody.current.scrollTo({
        top: consoleBody.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [visible.length, auto, paused]);
  const rows = visible.slice(full ? -700 : -220);
  return (
    <section className={`console ${full ? "full" : ""}`}>
      <div className="console-bar">
        <div>
          <span className="traffic red" />
          <span className="traffic amber" />
          <span className="traffic green" />
          <strong>SYSTEM EVENTS</strong>
          <small>{rows.length} visible</small>
        </div>
        <div className="console-tools">
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            {[
              "ALL",
              "INFO",
              "DATA",
              "DB",
              "AGG",
              "REPAIR",
              "WARN",
              "ERROR",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <input
            placeholder="Filter events…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className={paused ? "active" : ""}
            onClick={() => setPaused(!paused)}
          >
            {paused ? "RESUME" : "PAUSE"}
          </button>
          <button onClick={() => setAuto(!auto)}>
            AUTO {auto ? "ON" : "OFF"}
          </button>
          <button onClick={() => setClearedAt(events.length)}>
            CLEAR VIEW
          </button>
        </div>
      </div>
      <div className="console-body" ref={consoleBody}>
        {rows.map((e, i) => (
          <div className="log" key={e.id ?? `${e.timestamp}${i}`}>
            <time>{fmtTime(e.timestamp)}</time>
            <b className={`level ${String(e.level).toLowerCase()}`}>
              {e.level}
            </b>
            <span className="component">{e.component}</span>
            <span className="message">
              {e.symbol && <em>{e.symbol} </em>}
              {e.message}
            </span>
            {e.durationMs != null && <small>{e.durationMs}ms</small>}
          </div>
        ))}
      </div>
    </section>
  );
}
