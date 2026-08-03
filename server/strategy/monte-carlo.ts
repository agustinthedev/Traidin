import type { StrategyConfig } from "./model.js";
import type { SimTrade } from "./simulation.js";

export const MONTE_CARLO_ENGINE_VERSION = "2026.09.accounting.1";

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function percentile(values: number[], probability: number) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * probability))] ?? 0;
}

/**
 * Resamples realised outcomes. Fixed-risk strategies compound net R at the
 * configured equity risk; all other sizing models compound realised net return.
 * Equity is clamped only after a recorded ruin event, never allowed negative.
 */
export function monteCarlo(trades: SimTrade[], initialBalance: number, count: number, seed: number, config: StrategyConfig) {
  const random = seeded(seed);
  const finals: number[] = [];
  const drawdowns: number[] = [];
  const samples = Math.min(241, Math.max(2, trades.length + 1));
  const sampleAt = Array.from({ length: samples }, (_, index) => Math.min(trades.length, Math.round(index * trades.length / (samples - 1))));
  const paths: number[][] = [];
  const maxPaths = 1_000;
  const useR = config.sizing.type === "FIXED_RISK";
  const riskFraction = config.sizing.type === "FIXED_RISK" ? config.sizing.riskPct / 100 : 0;
  const ruined: Array<{ path: number; tradeIndex: number; equityAtRuin: number; reason: "EQUITY_DEPLETED" | "NON_FINITE_RETURN" }> = [];

  for (let pathIndex = 0; pathIndex < count; pathIndex++) {
    let equity = initialBalance;
    let peak = initialBalance;
    let maxDrawdownPct = 0;
    let nextSample = 1;
    let ruinedAt: number | null = null;
    const path = [initialBalance];

    for (let tradeIndex = 0; tradeIndex < trades.length; tradeIndex++) {
      if (ruinedAt == null) {
        const sampled = trades[Math.floor(random() * trades.length)];
        const netR = Number(sampled?.netRMultiple ?? sampled?.rMultiple ?? sampled?.details.netRMultiple);
        const netReturn = Number(sampled?.returnPct ?? 0) / 100;
        const pnl = useR && Number.isFinite(netR) ? equity * riskFraction * netR : equity * netReturn;
        const nextEquity = equity + pnl;
        if (!Number.isFinite(nextEquity) || nextEquity <= 0) {
          equity = 0;
          ruinedAt = tradeIndex;
          ruined.push({ path: pathIndex, tradeIndex: tradeIndex + 1, equityAtRuin: 0, reason: !Number.isFinite(nextEquity) ? "NON_FINITE_RETURN" : "EQUITY_DEPLETED" });
        } else equity = nextEquity;
        peak = Math.max(peak, equity);
        maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
      }
      while (nextSample < sampleAt.length && tradeIndex + 1 >= sampleAt[nextSample]) {
        path.push(equity);
        nextSample++;
      }
    }
    while (path.length < sampleAt.length) path.push(equity);
    finals.push(equity);
    drawdowns.push(maxDrawdownPct);
    if (paths.length < maxPaths) paths.push(path);
  }

  const percentilePaths = {
    p05: sampleAt.map((_, index) => percentile(paths.map((path) => path[index]), .05)),
    median: sampleAt.map((_, index) => percentile(paths.map((path) => path[index]), .5)),
    p95: sampleAt.map((_, index) => percentile(paths.map((path) => path[index]), .95)),
  };
  return {
    count, seed, model: useR ? "FIXED_EQUITY_R" : "COMPOUNDED_NET_RETURN", initialBalance,
    pathsShown: paths.length, samplePoints: samples, paths, percentilePaths,
    medianFinalEquity: percentile(finals, .5), p05FinalEquity: percentile(finals, .05), p95FinalEquity: percentile(finals, .95),
    medianMaxDrawdownPct: percentile(drawdowns, .5), p05MaxDrawdownPct: percentile(drawdowns, .05), p95MaxDrawdownPct: percentile(drawdowns, .95),
    probabilityOfProfit: finals.filter((value) => value > initialBalance).length / (finals.length || 1) * 100,
    ruinedPathCount: ruined.length, ruinProbabilityPct: ruined.length / (count || 1) * 100, ruinedPaths: ruined,
  };
}
