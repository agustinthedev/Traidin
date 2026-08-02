"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { AnyRow, apiJson } from "./ui";

function chartCandle(row?: AnyRow): CandlestickData<UTCTimestamp> | null {
  if (!row?.openTime) return null;
  const open = Number(row.open);
  const high = Number(row.high);
  const low = Number(row.low);
  const close = Number(row.close);
  const time = Math.floor(new Date(row.openTime).getTime() / 1000);
  if (![open, high, low, close, time].every(Number.isFinite)) return null;
  return { time: time as UTCTimestamp, open, high, low, close };
}

export default function CandlestickChart({
  symbol,
  liveCandle,
}: {
  symbol: string;
  liveCandle?: AnyRow;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fitted = useRef(false);
  const liveCandleRef = useRef(liveCandle);
  const candlesRef = useRef<CandlestickData<UTCTimestamp>[]>([]);
  const loadingOlderRef = useRef(false);
  const hasOlderRef = useRef(true);
  const loadOlderRef = useRef<() => void>(() => {});
  const [state, setState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#080808" },
        textColor: "#666666",
        fontFamily: '"Geist Mono Variable", Consolas, monospace',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#555555", labelBackgroundColor: "#252525" },
        horzLine: { color: "#555555", labelBackgroundColor: "#252525" },
      },
      rightPriceScale: {
        borderColor: "#292929",
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "#292929",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 8,
        minBarSpacing: 3,
      },
      handleScroll: true,
      handleScale: true,
    });
    const onVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (range && range.from < 24) loadOlderRef.current();
    };
    instance.timeScale().subscribeVisibleLogicalRangeChange(onVisibleRangeChange);
    const candleSeries = instance.addSeries(CandlestickSeries, {
      upColor: "#00d992",
      downColor: "#ff4d5e",
      wickUpColor: "#00d992",
      wickDownColor: "#ff4d5e",
      borderVisible: false,
      priceLineColor: "#00c2ff",
      priceLineWidth: 1,
      lastValueVisible: true,
    });
    chart.current = instance;
    series.current = candleSeries;
    return () => {
      instance.timeScale().unsubscribeVisibleLogicalRangeChange(onVisibleRangeChange);
      instance.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fitted.current = false;
    candlesRef.current = [];
    hasOlderRef.current = true;
    async function load(before?: number) {
      try {
        const cursor = before
          ? `&before=${encodeURIComponent(new Date(before * 1000).toISOString())}`
          : "";
        const rows = (await apiJson(
          `/api/candles/recent/${symbol}?timeframe=1m&limit=120${cursor}`,
        )) as AnyRow[];
        if (!active || !series.current || !chart.current) return;
        const page = rows
          .map(chartCandle)
          .filter((value): value is CandlestickData<UTCTimestamp> => !!value)
          .sort((a, b) => Number(a.time) - Number(b.time));
        if (before) {
          const byTime = new Map(candlesRef.current.map((candle) => [candle.time, candle]));
          for (const candle of page) byTime.set(candle.time, candle);
          candlesRef.current = [...byTime.values()].sort((a, b) => Number(a.time) - Number(b.time));
          hasOlderRef.current = page.length === 120;
        } else {
          candlesRef.current = page;
          hasOlderRef.current = page.length === 120;
        }
        series.current.setData(candlesRef.current);
        const current = chartCandle(liveCandleRef.current);
        if (current) series.current.update(current);
        if (!fitted.current && candlesRef.current.length) {
          chart.current.timeScale().setVisibleLogicalRange({
            from: Math.max(0, candlesRef.current.length - 90),
            to: candlesRef.current.length + 4,
          });
          fitted.current = true;
        }
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    }
    void load();
    loadOlderRef.current = () => {
      const oldest = candlesRef.current[0];
      if (!oldest || loadingOlderRef.current || !hasOlderRef.current) return;
      loadingOlderRef.current = true;
      void load(Number(oldest.time)).finally(() => { loadingOlderRef.current = false; });
    };
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      loadOlderRef.current = () => {};
      window.clearInterval(refresh);
    };
  }, [symbol]);

  useEffect(() => {
    liveCandleRef.current = liveCandle;
    const current = chartCandle(liveCandle);
    if (current && series.current) series.current.update(current);
  }, [liveCandle]);

  return (
    <div className="market-chart-shell">
      <div
        ref={container}
        className="market-chart"
        aria-label={`${symbol} 1 minute candlestick chart`}
      />
      {state !== "ready" && (
        <div className={`chart-state ${state}`}>
          {state === "loading" ? "LOADING 1m HISTORY…" : "CHART DATA UNAVAILABLE"}
        </div>
      )}
      <a
        className="chart-attribution"
        href="https://www.tradingview.com/"
        target="_blank"
        rel="noreferrer"
      >
        TradingView Lightweight Charts
      </a>
    </div>
  );
}
