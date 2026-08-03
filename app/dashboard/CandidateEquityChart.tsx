"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AreaSeries, ColorType, CrosshairMode, createChart, createSeriesMarkers, type IChartApi, type UTCTimestamp } from "lightweight-charts";

// Candidate metrics are persisted as heterogeneous JSON while a Research Run is in flight.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Point = { time: number; balance: number };
type Segment = { label: "IS" | "OOS" | "HOLDOUT"; color: string; band: string; start: number; end: number; points: Point[] };

const colors = { IS: { line: "#50b7ff", band: "rgba(80,183,255,.09)" }, OOS: { line: "#b7ff2a", band: "rgba(183,255,42,.085)" }, HOLDOUT: { line: "#f6b84a", band: "rgba(246,184,74,.10)" } } as const;
const asPoints = (value: unknown) => Array.isArray(value) ? value.map((point) => ({ time: Number((point as Row).time), balance: Number((point as Row).balance) })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.balance)).sort((left, right) => left.time - right.time) : [];

function segments(candidate: Row, run: Row): Segment[] {
  return (["IS", "OOS", "HOLDOUT"] as const).map((label) => {
    const key = label.toLowerCase(), period = run.periods?.[key] ?? {};
    return { label, color: colors[label].line, band: colors[label].band, start: new Date(period.start).getTime(), end: new Date(period.end).getTime(), points: asPoints(candidate.metrics?.[key]?.equity) };
  }).filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start);
}

export default function CandidateEquityChart({ candidate, run }: { candidate: Row; run: Row }) {
  const host = useRef<HTMLDivElement>(null), chart = useRef<IChartApi | null>(null);
  const [periodBands, setPeriodBands] = useState<Array<{ label: Segment["label"]; color: string; band: string; left: number; width: number }>>([]);
  const data = useMemo(() => segments(candidate, run), [candidate, run]);
  const evaluated = useMemo(() => data.filter((segment) => segment.points.length > 1), [data]);

  useEffect(() => {
    if (!host.current || !evaluated.length) return;
    const instance = createChart(host.current, { autoSize: true, height: 390, layout: { background: { type: ColorType.Solid, color: "#0b1016" }, textColor: "#8f9aa8", fontFamily: '"Geist Variable", Arial, sans-serif', fontSize: 11, attributionLogo: false }, grid: { vertLines: { color: "rgba(255,255,255,.045)" }, horzLines: { color: "rgba(255,255,255,.07)" } }, crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(183,255,42,.38)", labelBackgroundColor: "#283522" }, horzLine: { color: "rgba(183,255,42,.26)", labelBackgroundColor: "#283522" } }, rightPriceScale: { borderColor: "rgba(255,255,255,.14)", minimumWidth: 86 }, localization: { priceFormatter: (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value) }, timeScale: { borderColor: "rgba(255,255,255,.14)", timeVisible: true, secondsVisible: false, rightOffset: 5, barSpacing: 7, minBarSpacing: 1.5 } });
    const series = instance.addSeries(AreaSeries, { lineColor: "#b7ff2a", topColor: "rgba(183,255,42,.24)", bottomColor: "rgba(183,255,42,0)", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true, crosshairMarkerRadius: 4, crosshairMarkerBorderColor: "#111820", crosshairMarkerBackgroundColor: "#b7ff2a" });
    let carriedBalance: number | null = null;
    const stitched = new Map<number, number>(), markers: Array<{ time: UTCTimestamp; position: "inBar"; color: string; shape: "circle"; text: string }> = [];
    for (const segment of evaluated) {
      const scale: number = carriedBalance == null ? 1 : carriedBalance / segment.points[0].balance;
      if (carriedBalance != null) stitched.set(Math.floor(segment.start / 1000), carriedBalance);
      for (const point of segment.points) stitched.set(Math.floor(point.time / 1000), point.balance * scale);
      carriedBalance = segment.points.at(-1)!.balance * scale;
      stitched.set(Math.floor(segment.end / 1000), carriedBalance);
      markers.push({ time: Math.floor(segment.start / 1000) as UTCTimestamp, position: "inBar", color: segment.color, shape: "circle", text: segment.label });
    }
    const chartData = [...stitched.entries()].sort(([left], [right]) => left - right).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    series.setData(chartData);
    createSeriesMarkers(series, markers);
    instance.timeScale().setVisibleRange({ from: Math.floor(data[0].start / 1000) as UTCTimestamp, to: Math.floor(data.at(-1)!.end / 1000) as UTCTimestamp });
    const syncPeriodBands = () => setPeriodBands(data.flatMap((segment) => {
      const left = instance.timeScale().timeToCoordinate(Math.floor(segment.start / 1000) as UTCTimestamp), right = instance.timeScale().timeToCoordinate(Math.floor(segment.end / 1000) as UTCTimestamp);
      return left == null || right == null ? [] : [{ label: segment.label, color: segment.color, band: segment.band, left, width: Math.max(0, right - left) }];
    }));
    const frame = requestAnimationFrame(syncPeriodBands), observer = new ResizeObserver(() => requestAnimationFrame(syncPeriodBands));
    observer.observe(host.current);
    instance.timeScale().subscribeVisibleTimeRangeChange(syncPeriodBands);
    chart.current = instance;
    return () => { cancelAnimationFrame(frame); observer.disconnect(); instance.timeScale().unsubscribeVisibleTimeRangeChange(syncPeriodBands); instance.remove(); chart.current = null; };
  }, [data, evaluated]);

  return <section className="candidate-equity"><div className="equity-chart-head"><div><strong>Equity across evaluation periods</strong><small>Interactive stitched equity curve. IS, OOS and Holdout keep their independently calculated metrics.</small></div><div className="equity-legend">{data.map((segment) => <span key={segment.label} className={segment.label.toLowerCase()}><i style={{ background: segment.color }} />{segment.label}{segment.points.length > 1 ? "" : " · not evaluated"}</span>)}</div></div>{evaluated.length ? <div className="candidate-equity-chart-frame" aria-label="Interactive candidate equity chart"><div className="candidate-equity-canvas" ref={host} /><div className="candidate-period-overlays" aria-hidden="true">{periodBands.map((band) => <div className="candidate-period-band" key={band.label} style={{ left: `${band.left}px`, width: `${band.width}px`, backgroundColor: band.band, borderLeftColor: band.color }}><span style={{ color: band.color }}>{band.label}</span></div>)}</div></div> : <div className="candidate-chart-empty">No equity points are available for this Candidate yet.</div>}</section>;
}
