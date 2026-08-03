"use client";
import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, LineSeries, createChart, createSeriesMarkers, type CandlestickData, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { API, fmtDate, fmtNum } from "./ui";

type Overlay = { id: string; label: string; values: Array<{ time: number; value: number }> };
type Replay = { symbol: string; timeframe: string; trade: Record<string, unknown>; candles: Array<Record<string, unknown>>; overlays: Overlay[] };
const palette = ["#00c2ff", "#ff9f1a", "#a78bfa", "#00d992"];

export default function TradeReplay({ runId, sequence, onClose }: { runId: string; sequence: number; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState("");
  const [padding, setPadding] = useState(180);
  const [activeOverlays, setActiveOverlays] = useState<Set<string>>(new Set());

  useEffect(() => { setPadding(180); }, [runId, sequence]);
  useEffect(() => {
    let active = true;
    setReplay(null); setError("");
    fetch(`${API}/api/verification-runs/${runId}/replay?sequence=${sequence}&padding=${padding}`)
      .then(async (response) => { if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<Replay>; })
      .then((value) => { if (active) { setReplay(value); setActiveOverlays(new Set(value.overlays.map((overlay) => overlay.id))); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Replay unavailable"); });
    return () => { active = false; };
  }, [runId, sequence, padding]);

  useEffect(() => {
    if (!host.current || !replay) return;
    const instance = createChart(host.current, { autoSize: true, layout: { background: { type: ColorType.Solid, color: "#080808" }, textColor: "#8b8b8b", fontFamily: '"Geist Mono Variable", monospace', fontSize: 10, attributionLogo: false }, grid: { vertLines: { color: "rgba(255,255,255,.035)" }, horzLines: { color: "rgba(255,255,255,.045)" } }, rightPriceScale: { borderColor: "#292929" }, timeScale: { borderColor: "#292929", timeVisible: true, secondsVisible: false, rightOffset: 6 } });
    const candles = instance.addSeries(CandlestickSeries, { upColor: "#00d992", downColor: "#ff4d5e", wickUpColor: "#00d992", wickDownColor: "#ff4d5e", borderVisible: false });
    const data = replay.candles.map((row) => ({ time: Math.floor(new Date(String(row.openTime)).getTime() / 1000) as UTCTimestamp, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) })).filter((row) => Number.isFinite(row.time) && [row.open, row.high, row.low, row.close].every(Number.isFinite));
    candles.setData(data as CandlestickData<UTCTimestamp>[]);
    createSeriesMarkers(candles, [{ time: Math.floor(Number(replay.trade.entry_time) / 1000) as UTCTimestamp, position: replay.trade.side === "LONG" ? "belowBar" : "aboveBar", color: "#00d992", shape: "arrowUp", text: `ENTRY ${replay.trade.side}` }, { time: Math.floor(Number(replay.trade.exit_time) / 1000) as UTCTimestamp, position: replay.trade.side === "LONG" ? "aboveBar" : "belowBar", color: "#ff4d5e", shape: "arrowDown", text: String(replay.trade.exit_reason) }]);
    replay.overlays.filter((overlay) => activeOverlays.has(overlay.id)).forEach((overlay, index) => { const line = instance.addSeries(LineSeries, { color: palette[index % palette.length], lineWidth: 1, lastValueVisible: false, priceLineVisible: false }); line.setData(overlay.values.map((value) => ({ time: value.time as UTCTimestamp, value: value.value }))); });
    instance.timeScale().fitContent(); chart.current = instance;
    return () => { instance.remove(); chart.current = null; };
  }, [replay, activeOverlays]);

  const toggleOverlay = (id: string) => setActiveOverlays((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <section className="panel replay"><div className="panel-title"><span>TRADE REPLAY / #{sequence}</span><button onClick={onClose}>CLOSE REPLAY</button></div>{error ? <p className="empty">{error}</p> : !replay ? <p className="empty">Loading closed-candle replay...</p> : <><div className="replay-meta"><span>{replay.symbol} / {replay.timeframe}</span><span>{String(replay.trade.side)}</span><span>ENTRY {fmtDate(Number(replay.trade.entry_time))} @ {fmtNum(replay.trade.entry_price, 4)}</span><span>EXIT {fmtDate(Number(replay.trade.exit_time))} @ {fmtNum(replay.trade.exit_price, 4)}</span><span className={Number(replay.trade.net_pnl) >= 0 ? "positive" : "negative"}>NET {fmtNum(replay.trade.net_pnl, 2)}</span></div><div ref={host} className="replay-chart" aria-label="Interactive historical trade replay" /><div className="replay-controls">{replay.overlays.map((overlay) => <label key={overlay.id}><input type="checkbox" checked={activeOverlays.has(overlay.id)} onChange={() => toggleOverlay(overlay.id)} /> {overlay.label}</label>)}{padding < 2000 && <button onClick={() => setPadding((current) => Math.min(2000, current * 2))}>LOAD MORE CONTEXT ({padding} BARS)</button>}</div><div className="replay-legend"><b>Markers:</b> green entry · red exit {replay.overlays.length ? <> · <b>Active overlays:</b> {replay.overlays.filter((overlay) => activeOverlays.has(overlay.id)).map((overlay) => overlay.label).join(" · ") || "none"}</> : null}</div></>}</section>;
}
