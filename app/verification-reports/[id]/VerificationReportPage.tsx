"use client";

import { useEffect, useState } from "react";
import { Report } from "../../dashboard/StrategyVerification";
import { apiJson } from "../../dashboard/ui";

// API responses are heterogeneous JSON records until endpoint-specific schemas are shared with the client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export default function VerificationReportPage({ id }: { id: string }) {
  const [report, setReport] = useState<Row | null>(null);
  const [trades, setTrades] = useState<Row[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiJson(`/api/verification-runs/${id}`),
      apiJson(`/api/verification-runs/${id}/trades?limit=100`),
      apiJson(`/api/verification-runs/${id}/reproducibility`),
      apiJson(`/api/verification-runs/${id}/audit`),
    ]).then(([nextReport, nextTrades, reproducibility, audit]) => {
      if (!active) return;
      setReport({ ...nextReport, reproducibility, audit });
      setTrades(nextTrades);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load verification report");
    });
    return () => { active = false; };
  }, [id]);

  const clone = async (runId: string) => {
    const cloned = await apiJson(`/api/verification-runs/${runId}/clone`, { method: "POST" });
    window.location.href = `/verification-reports/${cloned.id}`;
  };
  // This link deliberately returns to the dashboard's client-side workspace entry point.
  // eslint-disable-next-line @next/next/no-html-link-for-pages
  return <main className="standalone-report-page"><header className="standalone-report-header"><a className="report-back-link" href="/">← BACK TO DASHBOARD</a><div><small>STRATEGY VERIFICATION / REPORT</small><h1>{report?.name ?? "Loading verification report"}</h1></div>{report && <span className={`tag ${report.status === "COMPLETED" ? "ok" : report.status === "FAILED" ? "failed" : "warn"}`}>{report.status}</span>}</header>{error ? <section className="notice"><strong>REPORT UNAVAILABLE</strong><p>{error}</p></section> : report ? <Report report={report} trades={trades} onClone={(runId) => void clone(runId)} /> : <section className="panel report-loading">Loading complete verification report…</section>}</main>;
}
