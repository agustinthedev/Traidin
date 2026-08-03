"use client";

import { useEffect, useRef } from "react";
import { fmtNum } from "./ui";

type MonteCarlo = { count: number; pathsShown?: number; paths?: number[][]; percentilePaths?: { p05: number[]; median: number[]; p95: number[] }; initialBalance: number; p05FinalEquity: number; medianFinalEquity: number; p95FinalEquity: number; probabilityOfProfit: number };

export default function MonteCarloPaths({ data }: { data: MonteCarlo }) {
  const host = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = host.current, paths = data.paths, band = data.percentilePaths;
    if (!canvas || !paths?.length || !band?.median.length) return;
    const render = () => {
      const bounds = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1, width = Math.max(1, Math.floor(bounds.width)), height = Math.max(1, Math.floor(bounds.height));
      canvas.width = width * ratio; canvas.height = height * ratio;
      const context = canvas.getContext("2d"); if (!context) return;
      context.scale(ratio, ratio); context.fillStyle = "#080808"; context.fillRect(0, 0, width, height);
      const values = [...paths.flat(), ...band.p05, ...band.median, ...band.p95, data.initialBalance].filter(Number.isFinite), low = Math.min(...values), high = Math.max(...values), padding = Math.max((high - low) * .08, 1), min = low - padding, max = high + padding;
      const x = (index: number) => 42 + index / Math.max(1, band.median.length - 1) * (width - 58), y = (value: number) => 18 + (max - value) / Math.max(1e-9, max - min) * (height - 42);
      context.strokeStyle = "rgba(255,255,255,.07)"; context.lineWidth = 1;
      for (let i = 0; i < 5; i++) { const lineY = 18 + i / 4 * (height - 42); context.beginPath(); context.moveTo(42, lineY); context.lineTo(width - 16, lineY); context.stroke(); context.fillStyle = "#69737f"; context.font = "9px monospace"; context.fillText(fmtNum(max - i / 4 * (max - min), 0), 2, lineY + 3); }
      context.beginPath(); band.p05.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); [...band.p95].reverse().forEach((value, index) => context.lineTo(x(band.p95.length - 1 - index), y(value))); context.closePath(); context.fillStyle = "rgba(45, 212, 191, .14)"; context.fill();
      context.strokeStyle = "rgba(118, 160, 196, .22)"; context.lineWidth = 1; paths.forEach((path) => { context.beginPath(); path.forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.stroke(); });
      context.setLineDash([5, 4]); context.strokeStyle = "#f5a524"; context.beginPath(); context.moveTo(42, y(data.initialBalance)); context.lineTo(width - 16, y(data.initialBalance)); context.stroke(); context.setLineDash([]);
      [[band.p05, "#ff5c5c"], [band.median, "#2dd4bf"], [band.p95, "#58a6ff"]].forEach(([series, color]) => { context.strokeStyle = String(color); context.lineWidth = 2; context.beginPath(); (series as number[]).forEach((value, index) => index ? context.lineTo(x(index), y(value)) : context.moveTo(x(index), y(value))); context.stroke(); });
      context.fillStyle = "#7e8a98"; context.font = "9px monospace"; context.fillText("TRADE SEQUENCE", width / 2 - 36, height - 8);
    };
    const observer = new ResizeObserver(render); observer.observe(canvas); render(); return () => observer.disconnect();
  }, [data]);
  if (!data.paths?.length || !data.percentilePaths) return null;
  return <section className="panel monte-carlo-paths"><div className="panel-title"><span>MONTE CARLO PATHS</span><small>{data.pathsShown ?? data.paths.length} / {data.count} SIMULATIONS · P5 / MEDIAN / P95</small></div><canvas ref={host} className="monte-carlo-chart" aria-label="Monte Carlo equity paths" /><div className="monte-carlo-legend"><span><i className="mc-path" /> Simulated paths</span><span><i className="mc-p05" /> P5 {fmtNum(data.p05FinalEquity, 0)}</span><span><i className="mc-median" /> Median {fmtNum(data.medianFinalEquity, 0)}</span><span><i className="mc-p95" /> P95 {fmtNum(data.p95FinalEquity, 0)}</span><span><i className="mc-initial" /> Initial {fmtNum(data.initialBalance, 0)}</span><span>Profit probability {fmtNum(data.probabilityOfProfit, 1)}%</span></div></section>;
}
