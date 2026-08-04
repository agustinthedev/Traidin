"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API, Empty, Metric, PageHead, apiJson, fmtDate, fmtNum } from "./ui";
import CandidateEquityChart from "./CandidateEquityChart";
import { notifyToast } from "./toast";

// Research responses are intentionally heterogeneous while the run is in flight.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type RegistryIndicator = { id: string; name: string; category: string };
const stateTone = (value?: string) =>
  ["COMPLETED", "HEALTHY", "PROMOTED"].includes(value ?? "")
    ? "ok"
    : [
          "FAILED",
          "CANCELLED",
          "EXHAUSTED",
          "HOLDOUT_REJECTED",
          "REJECTED",
          "EVALUATION_FAILED",
          "STRUCTURAL_REJECTED",
        ].includes(value ?? "")
      ? "failed"
      : "warn";
const primaryOutcome = (run: Row) =>
  run.terminalOutcome && !["PENDING", "LEGACY"].includes(run.terminalOutcome)
    ? run.terminalOutcome
    : run.status;
const short = (value?: string) => (value ? value.slice(0, 8) : "—");
const metricNumber = (value: unknown, max = 2) =>
  value == null ? "—" : fmtNum(value, max);
const usd = (value: unknown) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(value))
    : "—";
const labTimeframes = ["1m", "5m", "15m", "1h", "4h", "1d"];
const timeframeMinutes: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};
const requestFailed = (title: string, cause: unknown) =>
  notifyToast({
    tone: "error",
    title,
    message: cause instanceof Error ? cause.message : "Please try again.",
  });

export default function StrategyLab({
  initialRunId,
}: {
  initialRunId?: string;
}) {
  const [runs, setRuns] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setRuns(await apiJson("/api/research-runs"));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load Strategy Lab",
      );
    }
  };
  const open = async (id: string) => {
    try {
      setSelected(await apiJson(`/api/research-runs/${id}`));
      window.history.replaceState({}, "", `/strategy-lab/runs/${id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to open Research Run",
      );
    }
  };
  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, []);
  useEffect(() => {
    if (initialRunId)
      queueMicrotask(() => {
        void open(initialRunId);
      });
  }, [initialRunId]);
  const summary = useMemo(
    () => ({
      total: runs.length,
      running: runs.filter((run) =>
        ["RUNNING", "QUEUED", "INITIALIZING"].includes(run.status),
      ).length,
      completed: runs.filter((run) => run.status === "COMPLETED").length,
      candidates: runs.reduce(
        (sum, run) => sum + Number(run.generatedCount ?? 0),
        0,
      ),
      survivors: runs.reduce(
        (sum, run) => sum + Number(run.oosSurvivorCount ?? 0),
        0,
      ),
      promoted: runs.reduce(
        (sum, run) => sum + Number(run.promotedCount ?? 0),
        0,
      ),
    }),
    [runs],
  );
  if (selected)
    return (
      <ResearchRunDetail
        run={selected}
        onBack={() => {
          setSelected(null);
          window.history.replaceState({}, "", "/strategy-lab");
        }}
        onDelete={async () => {
          await apiJson(`/api/research-runs/${selected.id}`, {
            method: "DELETE",
          });
          await load();
          setSelected(null);
          window.history.replaceState({}, "", "/strategy-lab");
        }}
        onRefresh={async () => {
          await load();
          setSelected(await apiJson(`/api/research-runs/${selected.id}`));
        }}
      />
    );
  return (
    <div className="strategy-lab">
      <PageHead
        eyebrow="RESEARCH / STRATEGY LAB"
        title="Strategy Lab"
        aside={
          <button className="primary" onClick={() => setCreating(true)}>
            New Research Run
          </button>
        }
      />
      <p className="catalog-intro">
        Generate constrained, reproducible Candidates; screen them on
        IS/OOS/holdout; promote only confirmed definitions for deep
        verification.
      </p>
      <div className="metric-grid strategy-metrics">
        <Metric label="RESEARCH RUNS" value={summary.total} />
        <Metric label="ACTIVE" value={summary.running} tone="warning" />
        <Metric label="COMPLETED" value={summary.completed} tone="positive" />
        <Metric label="CANDIDATES GENERATED" value={summary.candidates} />
        <Metric label="OOS SURVIVORS" value={summary.survivors} tone="cyan" />
        <Metric label="PROMOTED" value={summary.promoted} tone="positive" />
      </div>
      {error && (
        <section className="notice notice-warning">
          <strong>STRATEGY LAB</strong>
          <p>{error}</p>
        </section>
      )}
      <section className="lab-toolbar">
        <span>Research Runs</span>
        <button onClick={() => void load()}>Refresh</button>
      </section>
      {runs.length === 0 ? (
        <Empty text="No Research Runs yet. Define a bounded search space and chronological periods to start." />
      ) : (
        <div className="research-run-grid">
          {runs.map((run) => (
            <article
              className="research-run-card"
              key={run.id}
              onClick={() => void open(run.id)}
            >
              <div>
                <span className={`tag ${stateTone(primaryOutcome(run))}`}>
                  {primaryOutcome(run)}
                </span>
                {primaryOutcome(run) !== run.status && (
                  <small className="operational-status">
                    Operational: {run.status}
                  </small>
                )}
                <span className={`tag ${stateTone(run.health)}`}>
                  {run.health}
                </span>
                {run.terminalOutcome && (
                  <span className={`tag ${stateTone(run.terminalOutcome)}`}>
                    {run.terminalOutcome}
                  </span>
                )}
              </div>
              <h2>{run.name}</h2>
              <p>
                {run.symbol} · {run.directions} · {run.triggerTimeframe} →{" "}
                {run.executionTimeframe}
              </p>
              <div className="research-progress">
                <i
                  style={{
                    width: `${Math.round(Number(run.progress ?? 0) * 100)}%`,
                  }}
                />
              </div>
              <small>
                {run.stage.replaceAll("_", " ")} ·{" "}
                {fmtNum(Number(run.progress ?? 0) * 100, 1)}%
              </small>
              {run.completionMessage && (
                <p className="research-completion-message">
                  {run.completionMessage}
                </p>
              )}
              <dl>
                <dt>Generated</dt>
                <dd>
                  {run.generatedCount}/{run.candidateBudget}
                </dd>
                <dt>IS / OOS</dt>
                <dd>
                  {run.isSurvivorCount} / {run.oosSurvivorCount}
                </dd>
                <dt>Finalists</dt>
                <dd>{run.finalistCount}</dd>
                <dt>Updated</dt>
                <dd>{fmtDate(run.updatedAt)}</dd>
              </dl>
            </article>
          ))}
        </div>
      )}
      {creating && (
        <CreateResearchRun
          onClose={() => setCreating(false)}
          onCreated={async (run) => {
            await load();
            setCreating(false);
            await open(run.id);
          }}
        />
      )}
    </div>
  );
}

function IndicatorMultiSelect({
  indicators,
  selected,
  onToggle,
  onSelectAll,
}: {
  indicators: RegistryIndicator[];
  selected: string[] | null;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = selected ?? indicators.map((indicator) => indicator.id),
    visible = indicators.filter((indicator) =>
      `${indicator.name} ${indicator.id} ${indicator.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
    groups = useMemo(
      () =>
        Object.entries(
          Object.groupBy(visible, (indicator) => indicator.category),
        ).sort(([left], [right]) => left.localeCompare(right)),
      [visible],
    );
  return (
    <fieldset className="research-building-blocks">
      <legend>Strategy building blocks</legend>
      <div className="indicator-select-summary">
        <span>
          {indicators.length
            ? `${chosen.length} of ${indicators.length} indicators selected`
            : "Loading indicator registry…"}
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={!indicators.length || selected === null}
        >
          Select all
        </button>
      </div>
      <details className="indicator-multi-select">
        <summary>Choose indicators for discovery</summary>
        <input
          aria-label="Search indicators"
          placeholder="Search indicators"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {groups.map(([category, group]) => (
          <section key={category}>
            <strong>{category.replaceAll("_", " ")}</strong>
            <div>
              {group!.map((indicator) => (
                <label key={indicator.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(indicator.id)}
                    onChange={() => onToggle(indicator.id)}
                  />
                  {indicator.name}
                </label>
              ))}
            </div>
          </section>
        ))}
      </details>
    </fieldset>
  );
}

function CreateResearchRun({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (run: Row) => Promise<void>;
}) {
  const [name, setName] = useState("Research Discovery");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [directions, setDirections] = useState("LONG_AND_SHORT");
  const [timeframe, setTimeframe] = useState("1h");
  const [executionTimeframe, setExecutionTimeframe] = useState("1m");
  const [budget, setBudget] = useState(100);
  const [availableIndicators, setAvailableIndicators] = useState<
    RegistryIndicator[]
  >([]);
  const [allowedIndicators, setAllowedIndicators] = useState<string[] | null>(
    null,
  );
  const [minTrades, setMinTrades] = useState(20);
  const [minProfitFactor, setMinProfitFactor] = useState(1.05);
  const [maxDrawdownPct, setMaxDrawdownPct] = useState(40);
  const [start, setStart] = useState("2024-01-01T00:00");
  const [end, setEnd] = useState("2025-12-31T00:00");
  const [splitMode, setSplitMode] = useState("AUTOMATIC");
  const [splitPolicy, setSplitPolicy] = useState("BALANCED");
  const [isStart, setIsStart] = useState("2024-01-01T00:00");
  const [isEnd, setIsEnd] = useState("2025-03-14T00:00");
  const [oosStart, setOosStart] = useState("2025-03-14T00:00");
  const [oosEnd, setOosEnd] = useState("2025-08-07T00:00");
  const [holdoutStart, setHoldoutStart] = useState("2025-08-07T00:00");
  const [holdoutEnd, setHoldoutEnd] = useState("2025-12-31T00:00");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void apiJson("/api/indicators")
      .then((rows: RegistryIndicator[]) => {
        if (active) setAvailableIndicators(rows);
      })
      .catch((cause) =>
        requestFailed("Unable to load indicator registry", cause),
      );
    return () => {
      active = false;
    };
  }, []);
  const toggleIndicator = (id: string) =>
    setAllowedIndicators((current) => {
      const selected =
          current ?? availableIndicators.map((indicator) => indicator.id),
        next = selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id];
      return next.length === availableIndicators.length ? null : next;
    });
  const submit = async () => {
    if (allowedIndicators?.length === 0) {
      setError("Select at least one indicator.");
      return;
    }
    try {
      const period = {
        mode: splitMode,
        policy: splitPolicy,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        ...(splitMode === "MANUAL"
          ? {
              isStart: new Date(isStart).toISOString(),
              isEnd: new Date(isEnd).toISOString(),
              oosStart: new Date(oosStart).toISOString(),
              oosEnd: new Date(oosEnd).toISOString(),
              holdoutStart: new Date(holdoutStart).toISOString(),
              holdoutEnd: new Date(holdoutEnd).toISOString(),
            }
          : {}),
      };
      const run = await apiJson("/api/research-runs", {
        method: "POST",
        body: JSON.stringify({
          name,
          symbol,
          directions,
          triggerTimeframe: timeframe,
          executionTimeframe,
          candidateBudget: budget,
          ...(allowedIndicators ? { allowedIndicators } : {}),
          minTrades,
          minProfitFactor,
          maxDrawdownPct,
          qualityGates: {
            is: { minTrades, minProfitFactor, maxDrawdownPct },
            oos: { minTrades, minProfitFactor, maxDrawdownPct },
            holdout: { minTrades, minProfitFactor, maxDrawdownPct },
          },
          period,
        }),
      });
      onClose();
      void onCreated(run);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create Research Run",
      );
    }
  };
  const changeTriggerTimeframe = (value: string) => {
    setTimeframe(value);
    if (timeframeMinutes[executionTimeframe] > timeframeMinutes[value])
      setExecutionTimeframe("1m");
  };
  return (
    <div className="lab-modal-backdrop" role="presentation">
      <section className="lab-modal" role="dialog" aria-modal="true">
        <div className="panel-title">
          <span>NEW RESEARCH RUN</span>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="research-form">
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Symbol
            <input
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Direction
            <select
              value={directions}
              onChange={(event) => setDirections(event.target.value)}
            >
              <option value="LONG_AND_SHORT">Long &amp; Short</option>
              <option value="LONG">Long only</option>
              <option value="SHORT">Short only</option>
            </select>
          </label>
          <label>
            Candidate budget
            <input
              type="number"
              min="1"
              max="1000"
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </label>
          <label>
            Trigger timeframe
            <select
              value={timeframe}
              onChange={(event) => changeTriggerTimeframe(event.target.value)}
            >
              {labTimeframes.slice(1).map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Execution timeframe
            <select
              value={executionTimeframe}
              onChange={(event) => setExecutionTimeframe(event.target.value)}
            >
              {labTimeframes
                .filter(
                  (value) =>
                    timeframeMinutes[value] <= timeframeMinutes[timeframe],
                )
                .map((value) => (
                  <option key={value}>{value}</option>
                ))}
            </select>
          </label>
          <IndicatorMultiSelect
            indicators={availableIndicators}
            selected={allowedIndicators}
            onToggle={toggleIndicator}
            onSelectAll={() => setAllowedIndicators(null)}
          />
          <fieldset className="research-quality-gates">
            <legend>
              Candidate evaluation rules{" "}
              <small>Applied independently to IS, OOS &amp; Holdout</small>
            </legend>
            <label>
              Minimum trades per stage
              <input
                type="number"
                min="0"
                value={minTrades}
                onChange={(event) => setMinTrades(Number(event.target.value))}
              />
            </label>
            <label>
              Minimum profit factor
              <input
                type="number"
                min="0"
                step="0.01"
                value={minProfitFactor}
                onChange={(event) =>
                  setMinProfitFactor(Number(event.target.value))
                }
              />
            </label>
            <label>
              Maximum drawdown (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={maxDrawdownPct}
                onChange={(event) =>
                  setMaxDrawdownPct(Number(event.target.value))
                }
              />
            </label>
          </fieldset>
          <label>
            Period split
            <select
              value={splitMode}
              onChange={(event) => setSplitMode(event.target.value)}
            >
              <option value="AUTOMATIC">Automatic</option>
              <option value="MANUAL">Manual</option>
            </select>
          </label>
          {splitMode === "AUTOMATIC" && (
            <label>
              Automatic policy
              <select
                value={splitPolicy}
                onChange={(event) => setSplitPolicy(event.target.value)}
              >
                <option value="BALANCED">
                  Balanced · IS 60% / OOS 20% / Holdout 20%
                </option>
                <option value="LOW_FREQUENCY">
                  Low frequency · IS 65% / OOS 20% / Holdout 15%
                </option>
                <option value="INTRADAY">
                  Intraday · IS 55% / OOS 25% / Holdout 20%
                </option>
              </select>
            </label>
          )}
          <label>
            Start
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          {splitMode === "MANUAL" && (
            <>
              <label>
                IS start
                <input
                  type="datetime-local"
                  value={isStart}
                  onChange={(event) => setIsStart(event.target.value)}
                />
              </label>
              <label>
                IS end
                <input
                  type="datetime-local"
                  value={isEnd}
                  onChange={(event) => setIsEnd(event.target.value)}
                />
              </label>
              <label>
                OOS start
                <input
                  type="datetime-local"
                  value={oosStart}
                  onChange={(event) => setOosStart(event.target.value)}
                />
              </label>
              <label>
                OOS end
                <input
                  type="datetime-local"
                  value={oosEnd}
                  onChange={(event) => setOosEnd(event.target.value)}
                />
              </label>
              <label>
                Holdout start
                <input
                  type="datetime-local"
                  value={holdoutStart}
                  onChange={(event) => setHoldoutStart(event.target.value)}
                />
              </label>
              <label>
                Holdout end
                <input
                  type="datetime-local"
                  value={holdoutEnd}
                  onChange={(event) => setHoldoutEnd(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="lab-modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void submit()}>
            Create Draft
          </button>
        </div>
      </section>
    </div>
  );
}

function ResearchRunDetail({
  run,
  onBack,
  onDelete,
  onRefresh,
}: {
  run: Row;
  onBack: () => void;
  onDelete: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [tab, setTab] = useState("Overview");
  const [selected, setSelected] = useState<Row | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const loadCandidates = useCallback(async () => {
    try {
      const result = await apiJson(
        `/api/research-runs/${run.id}/candidates?limit=500`,
      );
      setCandidates(result.rows);
    } catch (cause) {
      requestFailed("Unable to load Candidates", cause);
    }
  }, [run.id]);
  useEffect(() => {
    queueMicrotask(() => {
      void loadCandidates();
    });
  }, [loadCandidates]);
  const action = async (name: string) => {
    try {
      await apiJson(`/api/research-runs/${run.id}/${name}`, { method: "POST" });
      await onRefresh();
    } catch (cause) {
      requestFailed("Research Run update failed", cause);
    }
  };
  const funnel = [
    ["Requested", run.candidateBudget],
    ["Attempts", run.generationAttemptCount],
    ["Generation errors", run.generationErrorCount],
    ["Raw generated", run.generatedRawCount],
    ["Static rejected", run.staticRejectedCount],
    ["Preflight rejected", run.preflightRejectedCount],
    ["Exact duplicates", run.exactDuplicateCount],
    ["Semantic duplicates", run.semanticDuplicateCount],
    [
      "Accepted unique",
      run.acceptedValidUniqueCount ?? run.acceptedCandidateCount,
    ],
    ["Queued IS", run.queuedForIsCount],
    ["Evaluated IS", run.evaluatedInIsCount ?? run.isTestedCount],
    ["Rejected IS", run.rejectedInIsCount],
    ["Advanced OOS", run.advancedToOosCount ?? run.isSurvivorCount],
    ["Rejected OOS", run.rejectedInOosCount],
    ["Advanced Holdout", run.advancedToHoldoutCount ?? run.oosSurvivorCount],
    ["Rejected Holdout", run.rejectedInHoldoutCount],
    ["Evaluation failed", run.evaluationFailedCount],
    ["Cancelled", run.cancelledCount],
    ["Promoted", run.promotedCount],
  ];
  const canDelete = ["DRAFT", "COMPLETED", "FAILED", "CANCELLED"].includes(
    run.status,
  );
  const remove = async () => {
    if (
      !window.confirm(
        `Delete “${run.name}” and its Candidates and logs? This cannot be undone.`,
      )
    )
      return;
    try {
      await onDelete();
    } catch (cause) {
      requestFailed("Research Run deletion failed", cause);
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } catch (cause) {
      requestFailed("Unable to refresh Research Run", cause);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="research-detail">
      <PageHead
        eyebrow="RESEARCH / STRATEGY LAB / RUN"
        title={run.name}
        aside={
          <div className="catalog-actions">
            {run.status === "DRAFT" && (
              <button className="primary" onClick={() => void action("launch")}>
                Launch
              </button>
            )}
            {run.status === "RUNNING" && (
              <button onClick={() => void action("pause")}>Pause</button>
            )}
            {run.status === "PAUSED" && (
              <button onClick={() => void action("resume")}>Resume</button>
            )}
            {["QUEUED", "RUNNING", "PAUSING", "PAUSED", "RESUMING"].includes(
              run.status,
            ) && (
              <button
                className="danger-action"
                onClick={() => void action("cancel")}
              >
                Cancel
              </button>
            )}
            {canDelete && (
              <button className="danger-action" onClick={() => void remove()}>
                Delete
              </button>
            )}
            <button
              className="research-refresh"
              disabled={refreshing}
              aria-busy={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      />
      <button className="back-link" onClick={onBack}>
        ← Strategy Lab
      </button>
      <section className="research-hero">
        <div>
          <span className={`tag ${stateTone(primaryOutcome(run))}`}>
            {primaryOutcome(run)}
          </span>
          {primaryOutcome(run) !== run.status && (
            <small className="operational-status">
              Operational: {run.status}
            </small>
          )}
          <span className={`tag ${stateTone(run.health)}`}>{run.health}</span>
          {run.terminalOutcome && (
            <span className={`tag ${stateTone(run.terminalOutcome)}`}>
              {run.terminalOutcome}
            </span>
          )}
          <p>
            {run.symbol} · {run.directions} · trigger {run.triggerTimeframe} ·
            execution {run.executionTimeframe}
          </p>
          <div className="research-progress large">
            <i
              style={{
                width: `${Math.round(Number(run.progress ?? 0) * 100)}%`,
              }}
            />
          </div>
          <small>
            {run.stage.replaceAll("_", " ")} ·{" "}
            {fmtNum(Number(run.progress ?? 0) * 100, 1)}% · seed{" "}
            {run.randomSeed}
          </small>
          {run.completionMessage && (
            <p className="research-completion-message">
              {run.completionMessage}
            </p>
          )}
        </div>
        <div className="research-funnel">
          {funnel.map(([label, value]) => (
            <div key={String(label)}>
              <span>{label}</span>
              <b>{value}</b>
            </div>
          ))}
        </div>
      </section>
      <nav className="detail-tabs">
        {[
          "Overview",
          "Candidates",
          "Distribution",
          "Configuration",
          "Progress & Logs",
        ].map((item) => (
          <button
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </nav>
      {tab === "Overview" && (
        <section className="panel detail-panel">
          <div className="panel-title">
            <span>PIPELINE</span>
            <small>IS → OOS → HOLDOUT</small>
          </div>
          <div className="research-funnel full">
            {funnel.map(([label, value]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <dl className="report-dl">
            <dt>Periods</dt>
            <dd>
              {fmtDate(run.periods.is?.start)} →{" "}
              {fmtDate(run.periods.holdout?.end)}
            </dd>
            <dt>Config fingerprint</dt>
            <dd>{run.configHash}</dd>
            <dt>Engine / splitter</dt>
            <dd>
              {run.engineVersion} / {run.splitterVersion}
            </dd>
            <dt>Holdout exposure</dt>
            <dd>
              {run.holdoutExposed
                ? "Exposed"
                : run.holdoutEvaluated
                  ? "Evaluated, not exposed"
                  : "Not evaluated"}
            </dd>
            <dt>Accounting reconciliation</dt>
            <dd>
              {run.reconciliationStatus ?? "LEGACY"}{" "}
              {run.reconciliationMismatch
                ? `(mismatch ${run.reconciliationMismatch})`
                : ""}
            </dd>
            <dt>Completion reason</dt>
            <dd>{run.completionReason ?? "—"}</dd>
          </dl>
        </section>
      )}
      {tab === "Candidates" && (
        <CandidateTable
          candidates={candidates}
          runId={run.id}
          onOpen={setSelected}
        />
      )}
      {tab === "Distribution" && (
        <Distribution candidates={candidates} onOpen={setSelected} />
      )}
      {tab === "Configuration" && (
        <section className="panel detail-panel">
          <div className="panel-title">
            <span>IMMUTABLE RUN CONFIGURATION</span>
          </div>
          <pre className="lab-config">
            {JSON.stringify(
              {
                config: run.config,
                periods: run.periods,
                fingerprint: run.datasetFingerprint,
              },
              null,
              2,
            )}
          </pre>
        </section>
      )}
      {tab === "Progress & Logs" && (
        <ProgressLogTable events={run.events ?? []} />
      )}
      {selected && (
        <CandidateExplorer
          candidate={selected}
          run={run}
          onClose={() => setSelected(null)}
          onPromoted={async () => {
            setSelected(null);
            await loadCandidates();
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        className={`sortable-header ${active ? "active" : ""}`}
        onClick={onClick}
      >
        {label}
        <span aria-hidden="true">
          {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
function CandidateTable({
  candidates,
  runId,
  onOpen,
}: {
  candidates: Row[];
  runId: string;
  onOpen: (candidate: Row) => void;
}) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "score",
    direction: "desc",
  });
  const ranked = useMemo(
    () =>
      [...candidates].sort(
        (left, right) =>
          Number(right.score ?? -Infinity) - Number(left.score ?? -Infinity),
      ),
    [candidates],
  );
  const ranks = useMemo(
    () => new Map(ranked.map((candidate, index) => [candidate.id, index + 1])),
    [ranked],
  );
  const value = useCallback(
    (candidate: Row, key: string) =>
      key === "rank"
        ? (ranks.get(candidate.id) ?? 0)
        : key === "candidate"
          ? candidate.id
          : key === "status"
            ? candidate.status
            : key === "family"
              ? candidate.family
              : key === "complexity"
                ? Number(candidate.complexityScore ?? 0)
                : key === "is"
                  ? Number(candidate.metrics?.is?.profitFactor ?? -Infinity)
                  : key === "oos"
                    ? Number(candidate.metrics?.oos?.profitFactor ?? -Infinity)
                    : key === "holdout"
                      ? Number(
                          candidate.metrics?.holdout?.profitFactor ?? -Infinity,
                        )
                      : Number(candidate.score ?? -Infinity),
    [ranks],
  );
  const ordered = useMemo(
    () =>
      [...candidates].sort((left, right) => {
        const a = value(left, sort.key),
          b = value(right, sort.key),
          compared =
            typeof a === "string" && typeof b === "string"
              ? a.localeCompare(b)
              : Number(a) - Number(b);
        return sort.direction === "asc" ? compared : -compared;
      }),
    [candidates, sort, value],
  );
  const toggle = (key: string) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : {
            key,
            direction:
              key === "candidate" || key === "status" || key === "family"
                ? "asc"
                : "desc",
          },
    );
  const header = (label: string, key: string) => (
    <SortableHeader
      label={label}
      active={sort.key === key}
      direction={sort.direction}
      onClick={() => toggle(key)}
    />
  );
  return (
    <section className="panel candidate-table-panel">
      <div className="candidate-table-head">
        <div>
          <strong>CANDIDATE STRATEGIES</strong>
          <small>
            {candidates.length} persisted candidates · metrics and
            configurations included in the consolidated report
          </small>
        </div>
        <a
          className="candidate-report-download"
          href={`${API}/api/research-runs/${runId}/candidates/report.pdf`}
        >
          DOWNLOAD ALL CANDIDATES REPORT
        </a>
      </div>
      <div className="table-wrap lab-candidate-table">
        <table>
          <thead>
            <tr>
              {header("RANK", "rank")}
              {header("CANDIDATE", "candidate")}
              {header("STATUS", "status")}
              {header("FAMILY", "family")}
              {header("COMPLEXITY", "complexity")}
              {header("IS PF", "is")}
              {header("OOS PF", "oos")}
              {header("HOLDOUT PF", "holdout")}
              {header("SCORE", "score")}
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.length ? (
              ordered.map((candidate) => (
                <tr key={candidate.id}>
                  <td>#{ranks.get(candidate.id)}</td>
                  <td>
                    {short(candidate.id)}
                    <small className="block">
                      {short(candidate.normalizedHash)}
                    </small>
                  </td>
                  <td>
                    <span className={`tag ${stateTone(candidate.status)}`}>
                      {candidate.status}
                    </span>
                  </td>
                  <td>{candidate.family}</td>
                  <td>{candidate.complexityScore}</td>
                  <td>{metricNumber(candidate.metrics?.is?.profitFactor)}</td>
                  <td>{metricNumber(candidate.metrics?.oos?.profitFactor)}</td>
                  <td>
                    {metricNumber(candidate.metrics?.holdout?.profitFactor)}
                  </td>
                  <td>{metricNumber(candidate.score)}</td>
                  <td>
                    <button onClick={() => onOpen(candidate)}>View</button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10}>No Candidates have been persisted yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function ProgressLogTable({ events }: { events: Row[] }) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "timestamp",
    direction: "desc",
  });
  const value = useCallback(
    (event: Row, key: string) =>
      key === "timestamp"
        ? new Date(event.timestamp).getTime()
        : String(event[key] ?? ""),
    [],
  );
  const ordered = useMemo(
    () =>
      [...events].sort((left, right) => {
        const a = value(left, sort.key),
          b = value(right, sort.key),
          compared =
            typeof a === "string" && typeof b === "string"
              ? a.localeCompare(b)
              : Number(a) - Number(b);
        return sort.direction === "asc" ? compared : -compared;
      }),
    [events, sort, value],
  );
  const toggle = (key: string) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "timestamp" ? "desc" : "asc" },
    );
  const header = (label: string, key: string) => (
    <SortableHeader
      label={label}
      active={sort.key === key}
      direction={sort.direction}
      onClick={() => toggle(key)}
    />
  );
  return (
    <section className="table-wrap">
      <table>
        <thead>
          <tr>
            {header("TIME", "timestamp")}
            {header("LEVEL", "level")}
            {header("STAGE", "stage")}
            {header("EVENT", "event_type")}
            {header("MESSAGE", "message")}
          </tr>
        </thead>
        <tbody>
          {ordered.map((event) => (
            <tr key={event.id}>
              <td>{fmtDate(event.timestamp)}</td>
              <td>{event.level}</td>
              <td>{event.stage}</td>
              <td>{event.event_type}</td>
              <td>{event.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
function Distribution({
  candidates,
  onOpen,
}: {
  candidates: Row[];
  onOpen: (candidate: Row) => void;
}) {
  const points = candidates.filter((candidate) => candidate.score != null);
  const maxScore = Math.max(
    1,
    ...points.map((candidate) => Number(candidate.score)),
  );
  return (
    <section className="distribution">
      <div className="distribution-head">
        <strong>OOS PROFIT FACTOR × COMPOSITE SCORE</strong>
        <small>Each point is a persisted Candidate. Click to inspect.</small>
      </div>
      <div className="distribution-chart">
        {points.map((candidate) => (
          <button
            key={candidate.id}
            className={`distribution-point ${stateTone(candidate.status)}`}
            style={{
              left: `${Math.max(2, Math.min(97, (Number(candidate.metrics?.oos?.profitFactor ?? 0) / 3) * 100))}%`,
              bottom: `${Math.max(2, Math.min(97, (Number(candidate.score) / maxScore) * 100))}%`,
            }}
            title={`${short(candidate.id)} · ${candidate.score}`}
            onClick={() => onOpen(candidate)}
          />
        ))}
        <span className="axis-y">Composite score</span>
        <span className="axis-x">OOS profit factor →</span>
      </div>
    </section>
  );
}
function CandidateExplorer({
  candidate,
  run,
  onClose,
  onPromoted,
}: {
  candidate: Row;
  run: Row;
  onClose: () => void;
  onPromoted: () => Promise<void>;
}) {
  const [name, setName] = useState(
    `Lab ${candidate.family} ${short(candidate.id)}`,
  );
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promote = async () => {
    try {
      await apiJson(`/api/research-candidates/${candidate.id}/promote`, {
        method: "POST",
        body: JSON.stringify({
          name,
          description: `Promoted Strategy Lab candidate ${candidate.id}`,
          tags: ["strategy-lab", candidate.family.toLowerCase()],
          verify,
        }),
      });
      await onPromoted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Promotion failed");
    }
  };
  return (
    <div className="lab-modal-backdrop">
      <section className="candidate-explorer" role="dialog" aria-modal="true">
        <div className="panel-title">
          <span>CANDIDATE PERFORMANCE EXPLORER</span>
          <button onClick={onClose}>Close</button>
        </div>
        <header>
          <div>
            <span className={`tag ${stateTone(candidate.status)}`}>
              {candidate.status}
            </span>
            <h2>
              {short(candidate.id)} · {candidate.family}
            </h2>
            <p>
              Complexity {candidate.complexityScore} · score{" "}
              {metricNumber(candidate.score)} · normalized{" "}
              {short(candidate.normalizedHash)}
            </p>
          </div>
        </header>
        <section className="candidate-readable-description">
          <small>HUMAN-READABLE STRATEGY DESCRIPTION</small>
          <pre>
            {candidate.humanDescription ??
              "Description unavailable for this legacy Candidate."}
          </pre>
        </section>
        <section className="candidate-diagnostics">
          <div>
            <small>TEMPLATES / ROLES</small>
            <pre>
              {JSON.stringify(
                {
                  templates: candidate.templateIds,
                  versions: candidate.templateVersions,
                  predicates: candidate.predicateMetadata,
                },
                null,
                2,
              )}
            </pre>
          </div>
          <div>
            <small>VALIDATION / REJECTION</small>
            <pre>
              {JSON.stringify(
                {
                  structural: candidate.structuralValidation,
                  simplification: candidate.structuralActions,
                  preflight: candidate.preflightDiagnostics,
                  duplicateOf: candidate.duplicateOfCandidateId,
                  stage: candidate.rejectionStage,
                  code: candidate.rejectionReason,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </section>
        <CandidateEquityChart candidate={candidate} run={run} />
        <section className="candidate-metrics">
          {["is", "oos", "holdout"].map((period) => {
            const metric = candidate.metrics?.[period] as Row | undefined,
              equity = Array.isArray(metric?.equity)
                ? (metric.equity as Row[])
                : [],
              first = equity[0]?.balance,
              last = equity.at(-1)?.balance;
            return (
              <div key={period}>
                <small>{period.toUpperCase()}</small>
                {metric ? (
                  <>
                    <b>PF {metricNumber(metric.profitFactor)}</b>
                    <span>
                      {metricNumber(metric.trades, 0)} trades ·{" "}
                      {metricNumber(metric.return)}%
                    </span>
                    <em>
                      {equity.length
                        ? `${usd(first)} → ${usd(last)}`
                        : "Equity unavailable"}
                    </em>
                  </>
                ) : (
                  <>
                    <b>Not evaluated</b>
                    <span>Not eligible for this stage</span>
                  </>
                )}
              </div>
            );
          })}
        </section>
        <details>
          <summary>Normalized rule tree and configuration</summary>
          <pre className="lab-config">
            {JSON.stringify(
              {
                normalized: candidate.normalizedAst,
                configuration: candidate.configuration,
                metrics: candidate.metrics,
                preflightDiagnostics: candidate.preflightDiagnostics,
                formatterVersion: candidate.formatterVersion,
              },
              null,
              2,
            )}
          </pre>
        </details>
        {candidate.status === "COMPLETED" && (
          <section className="promotion-form">
            <label>
              Strategy name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={verify}
                onChange={(event) => setVerify(event.target.checked)}
              />{" "}
              Create & run Full Verification
            </label>
            <button className="primary" onClick={() => void promote()}>
              Create Strategy
            </button>
            {error && <span className="form-error">{error}</span>}
          </section>
        )}
      </section>
    </div>
  );
}
