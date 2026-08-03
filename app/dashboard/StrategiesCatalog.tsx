"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Metric, PageHead, apiJson, fmtDate } from "./ui";

// API resources are heterogeneous but are validated by the Fastify contracts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tagTone = (value?: string) => value === "VERIFIED" || value === "COMPLETED" ? "ok" : value === "FAILED" || value === "RETIRED" ? "failed" : "warn";

function strategyLogic(version?: Row | null) {
  if (!version) return "No immutable version published";
  const config = version.configuration ?? {};
  return `${config.directions ?? "—"} · ${config.triggerTimeframe ?? "—"} trigger · ${config.executionTimeframe ?? "—"} execution`;
}

export default function StrategiesCatalog({ initialStrategyId, onOpenBuilder, onOpenVerifier }: { initialStrategyId?: string; onOpenBuilder: () => void; onOpenVerifier: () => void }) {
  const [strategies, setStrategies] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Row | null>(null);
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("ALL");
  const [origin, setOrigin] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try { setStrategies(await apiJson("/api/strategies")); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load strategies"); }
  };
  const open = async (id: string) => {
    try { setSelected(await apiJson(`/api/strategies/${id}`)); window.history.replaceState({}, "", `/strategies/${id}`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open strategy"); }
  };
  useEffect(() => { queueMicrotask(() => { void load(); }); }, []);
  useEffect(() => { if (initialStrategyId) queueMicrotask(() => { void open(initialStrategyId); }); }, [initialStrategyId]);
  const visible = useMemo(() => strategies.filter((item) => (!query || [item.name, item.description, ...(item.tags ?? [])].join(" ").toLowerCase().includes(query.toLowerCase())) && (lifecycle === "ALL" || item.lifecycle === lifecycle) && (origin === "ALL" || item.origin === origin)), [strategies, query, lifecycle, origin]);
  const counts = useMemo(() => ({ total: strategies.length, versions: strategies.reduce((sum, item) => sum + Number(item.versionCount ?? item.versions?.length ?? 0), 0), ready: strategies.filter((item) => item.lifecycle === "READY_FOR_DEEP_VERIFICATION").length, verified: strategies.filter((item) => item.lifecycle === "VERIFIED").length, lab: strategies.filter((item) => item.origin === "STRATEGY_LAB").length, noVerification: strategies.filter((item) => !item.verificationRunsCount).length }), [strategies]);
  if (selected) return <StrategyDetail strategy={selected} onBack={() => { setSelected(null); window.history.replaceState({}, "", "/strategies"); }} onOpenBuilder={onOpenBuilder} onOpenVerifier={onOpenVerifier} onChanged={async () => { await load(); setSelected(await apiJson(`/api/strategies/${selected.id}`)); }} />;
  return <div className="strategies-catalog"><PageHead eyebrow="RESEARCH / STRATEGIES" title="Strategies" aside={<div className="catalog-actions"><button className="primary" onClick={onOpenBuilder}>Create Strategy</button><button onClick={() => window.location.assign("/strategy-lab")}>Open Strategy Lab</button></div>} />
    <p className="catalog-intro">Central catalog for versioned strategy definitions, verification coverage, and research provenance.</p>
    <div className="metric-grid strategy-metrics"><Metric label="TOTAL STRATEGIES" value={counts.total} /><Metric label="IMMUTABLE VERSIONS" value={counts.versions} /><Metric label="READY FOR DEEP VERIFICATION" value={counts.ready} tone="warning" /><Metric label="VERIFIED" value={counts.verified} tone="positive" /><Metric label="LAB ORIGIN" value={counts.lab} tone="cyan" /><Metric label="NO VERIFICATION" value={counts.noVerification} tone={counts.noVerification ? "warning" : "positive"} /></div>
    <section className="strategy-filter-bar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, description, tag…" aria-label="Search strategies" /><select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} aria-label="Filter lifecycle"><option value="ALL">All lifecycles</option><option>DRAFT</option><option>READY_FOR_DEEP_VERIFICATION</option><option>VERIFIED</option><option>RETIRED</option></select><select value={origin} onChange={(event) => setOrigin(event.target.value)} aria-label="Filter origin"><option value="ALL">All origins</option><option>MANUAL</option><option>STRATEGY_LAB</option></select><button onClick={() => void load()}>Refresh</button></section>
    {error && <section className="notice notice-warning"><strong>STRATEGIES</strong><p>{error}</p></section>}
    {visible.length === 0 ? <Empty text="No strategy matches these filters. Create one in Strategy Builder or promote a Candidate from Strategy Lab." /> : <div className="strategy-card-grid">{visible.map((strategy) => <article className="strategy-card" key={strategy.id}><div className="strategy-card-head"><div><span className={`tag ${tagTone(strategy.lifecycle)}`}>{strategy.lifecycle}</span><span className="tag muted">{strategy.origin === "STRATEGY_LAB" ? "STRATEGY LAB" : "MANUAL"}</span></div><time>{fmtDate(strategy.updatedAt)}</time></div><h2>{strategy.name}</h2><p>{strategy.description || "No description supplied."}</p><div className="strategy-logic">{strategyLogic(strategy.latestVersion ?? strategy.versions?.[0])}</div><div className="strategy-card-data"><span><b>{strategy.versionCount ?? strategy.versions?.length ?? 0}</b> versions</span><span><b>{strategy.verificationRunsCount ?? 0}</b> verifications</span><span><b>{strategy.origin === "STRATEGY_LAB" ? 1 : 0}</b> research runs</span></div>{strategy.warnings?.length > 0 && <div className="strategy-warnings">{strategy.warnings.map((warning: string) => <span key={warning}>{warning.replaceAll("_", " ")}</span>)}</div>}<div className="strategy-card-actions"><button onClick={() => void open(strategy.id)}>Open</button><button onClick={onOpenBuilder}>Edit in Builder</button></div></article>)}</div>}
  </div>;
}

function StrategyDetail({ strategy, onBack, onOpenBuilder, onOpenVerifier, onChanged }: { strategy: Row; onBack: () => void; onOpenBuilder: () => void; onOpenVerifier: () => void; onChanged: () => Promise<void> }) {
  const [tab, setTab] = useState("Overview");
  const latest = strategy.versions?.[0];
  const retire = async () => { await apiJson(`/api/strategies/${strategy.id}/retire`, { method: "POST" }); await onChanged(); };
  return <div className="strategy-detail"><PageHead eyebrow="RESEARCH / STRATEGIES / DETAIL" title={strategy.name} aside={<div className="catalog-actions"><button onClick={onOpenBuilder}>Open in Builder</button><button onClick={onOpenVerifier}>Run Full Verification</button>{strategy.lifecycle !== "RETIRED" && <button className="danger-action" onClick={() => void retire()}>Retire</button>}</div>} /><button className="back-link" onClick={onBack}>← All Strategies</button><section className="strategy-detail-summary"><div><span className={`tag ${tagTone(strategy.lifecycle)}`}>{strategy.lifecycle}</span><span className="tag muted">{strategy.origin}</span><p>{strategy.description || "No description supplied."}</p></div><dl><dt>Latest version</dt><dd>{latest ? `v${latest.versionNumber}` : "—"}</dd><dt>Versions</dt><dd>{strategy.versions?.length ?? 0}</dd><dt>Created</dt><dd>{fmtDate(strategy.createdAt)}</dd><dt>Updated</dt><dd>{fmtDate(strategy.updatedAt)}</dd></dl></section><nav className="detail-tabs">{["Overview", "Versions", "Verification", "Research", "Timeline"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {tab === "Overview" && <section className="panel detail-panel"><div className="panel-title"><span>STRATEGY SUMMARY</span><small>ENTITY-LEVEL INFORMATION</small></div><dl className="report-dl"><dt>Logic</dt><dd>{strategyLogic(latest)}</dd><dt>Verification coverage</dt><dd>{strategy.verificationRuns?.length ?? 0} linked runs</dd><dt>Research lineage</dt><dd>{strategy.sourceResearchRunId ? `Research run ${strategy.sourceResearchRunId.slice(0, 8)} · Candidate ${strategy.sourceCandidateId?.slice(0, 8) ?? "—"}` : "Manual creation"}</dd><dt>Recommended action</dt><dd>{strategy.lifecycle === "READY_FOR_DEEP_VERIFICATION" ? "Launch a full verification for the latest version." : strategy.lifecycle === "DRAFT" ? "Publish an immutable version." : "Review the latest verification."}</dd></dl></section>}
    {tab === "Versions" && <section className="table-wrap"><table><thead><tr><th>VERSION</th><th>CREATED</th><th>HASH</th><th>STATUS</th><th>CHANGE NOTES</th></tr></thead><tbody>{strategy.versions?.map((version: Row) => <tr key={version.id}><td>v{version.versionNumber}</td><td>{fmtDate(version.createdAt)}</td><td>{version.configurationHash.slice(0, 12)}</td><td><span className={`tag ${tagTone(version.verificationStatus)}`}>{version.verificationStatus}</span></td><td>{version.changeNotes || "—"}</td></tr>)}</tbody></table></section>}
    {tab === "Verification" && <section className="table-wrap"><table><thead><tr><th>RUN</th><th>VERSION</th><th>STATUS</th><th>TYPE</th><th>RANGE</th><th>CREATED</th></tr></thead><tbody>{strategy.verificationRuns?.length ? strategy.verificationRuns.map((run: Row) => <tr key={run.id}><td>{run.name}<small className="block">{run.id.slice(0, 8)}</small></td><td>v{strategy.versions?.find((version: Row) => version.id === run.strategyVersionId)?.versionNumber ?? "—"}</td><td><span className={`tag ${tagTone(run.status)}`}>{run.status}</span></td><td>{run.profile}</td><td>{fmtDate(run.requestedStart)} → {fmtDate(run.requestedEnd)}</td><td>{fmtDate(run.createdAt)}</td></tr>) : <tr><td colSpan={6}>No full verification has been launched for this Strategy.</td></tr>}</tbody></table></section>}
    {tab === "Research" && <section className="panel detail-panel"><div className="panel-title"><span>RESEARCH LINEAGE</span></div>{strategy.sourceResearchRunId ? <dl className="report-dl"><dt>Research Run</dt><dd>{strategy.sourceResearchRunId}</dd><dt>Candidate</dt><dd>{strategy.sourceCandidateId}</dd><dt>Normalized hash</dt><dd>{strategy.sourceNormalizedHash}</dd></dl> : <Empty text="This Strategy was created manually and has no Research Candidate provenance." />}</section>}
    {tab === "Timeline" && <section className="table-wrap"><table><thead><tr><th>TIME</th><th>EVENT</th><th>DETAIL</th></tr></thead><tbody>{strategy.timeline?.map((event: Row) => <tr key={event.id}><td>{fmtDate(event.createdAt)}</td><td>{event.event_type}</td><td>{JSON.stringify(event.details)}</td></tr>)}</tbody></table></section>}
  </div>;
}
