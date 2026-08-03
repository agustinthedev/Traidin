"use client";
import { useEffect, useRef } from "react";
import { ColorType, LineSeries, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";

type Point = { time: number; balance?: number; drawdownPct?: number };
const chartOptions = { autoSize: true, layout: { background: { type: ColorType.Solid, color: "#080808" }, textColor: "#777", fontFamily: '"Geist Mono Variable", monospace', fontSize: 9, attributionLogo: false }, grid: { vertLines: { color: "rgba(255,255,255,.035)" }, horzLines: { color: "rgba(255,255,255,.045)" } }, timeScale: { borderColor: "#292929", timeVisible: true, secondsVisible: false }, rightPriceScale: { borderColor: "#292929" } } as const;

export default function EquityDrawdown({ equity, underwater }: { equity: Point[]; underwater: Point[] }) {
  const equityHost = useRef<HTMLDivElement>(null), drawdownHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!equityHost.current || !drawdownHost.current) return;
    const balanceChart: IChartApi = createChart(equityHost.current, chartOptions), drawdownChart: IChartApi = createChart(drawdownHost.current, chartOptions);
    const balance = balanceChart.addSeries(LineSeries, { color: "#00d992", lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
    balance.setData(equity.filter((point) => Number.isFinite(point.time) && Number.isFinite(point.balance)).map((point) => ({ time: Math.floor(point.time / 1000) as UTCTimestamp, value: Number(point.balance) })));
    const drawdown = drawdownChart.addSeries(LineSeries, { color: "#ff4d5e", lineWidth: 2, lastValueVisible: true, priceLineVisible: false });
    drawdown.setData(underwater.filter((point) => Number.isFinite(point.time) && Number.isFinite(point.drawdownPct)).map((point) => ({ time: Math.floor(point.time / 1000) as UTCTimestamp, value: Number(point.drawdownPct) })));
    balanceChart.timeScale().fitContent(); drawdownChart.timeScale().fitContent();
    return () => { balanceChart.remove(); drawdownChart.remove(); };
  }, [equity, underwater]);
  return <section className="panel equity-drawdown"><div className="panel-title"><span>EQUITY & DRAWDOWN</span><small>CLOSED-BALANCE CURVES</small></div><div className="equity-chart-grid"><div><small>EQUITY / BALANCE</small><div ref={equityHost} className="equity-chart" /></div><div><small>DRAWDOWN %</small><div ref={drawdownHost} className="equity-chart" /></div></div></section>;
}
