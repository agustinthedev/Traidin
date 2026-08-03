import { FeatureEngine } from "./feature-engine.js";
import { verificationMetrics } from "./metrics.js";
import { canonicalJson, researchRunSchema, strategyConfigSchema, type ResearchRunInput, type StrategyConfig } from "./model.js";
import { normalizedCandidateHash, complexityOf } from "./research-normalization.js";
import { researchRepository } from "./research-repository.js";
import { candleRepository } from "../db/repository.js";
import { dataFingerprint } from "./verification-worker.js";
import { simulate } from "./simulation.js";
import { createHash } from "node:crypto";

export const RESEARCH_ENGINE_VERSION = "2026.09.chronological-compounding.1";
export const RESEARCH_SPLITTER_VERSION = "2026.08.chronological.1";

type Periods = { is: { start: Date; end: Date }; oos: { start: Date; end: Date }; holdout: { start: Date; end: Date } };
export function splitResearchPeriod(input: ResearchRunInput): Periods {
  const period = input.period;
  if (period.end <= period.start) throw new Error("The total range must end after its start");
  if (period.mode === "MANUAL") {
    if (!period.isStart || !period.isEnd || !period.oosStart || !period.oosEnd || !period.holdoutStart || !period.holdoutEnd) throw new Error("Manual periods require IS, OOS and holdout boundaries");
    const values = [period.isStart, period.isEnd, period.oosStart, period.oosEnd, period.holdoutStart, period.holdoutEnd];
    if (values.some((value, index) => index > 0 && value <= values[index - 1])) throw new Error("Research periods must be chronological and non-overlapping");
    return { is: { start: period.isStart, end: period.isEnd }, oos: { start: period.oosStart, end: period.oosEnd }, holdout: { start: period.holdoutStart, end: period.holdoutEnd } };
  }
  const ratios = period.policy === "LOW_FREQUENCY" ? [.65, .2, .15] : period.policy === "INTRADAY" ? [.55, .25, .2] : [.6, .2, .2];
  const total = period.end.getTime() - period.start.getTime(), isEnd = new Date(period.start.getTime() + total * ratios[0]), oosEnd = new Date(isEnd.getTime() + total * ratios[1]);
  return { is: { start: period.start, end: isEnd }, oos: { start: isEnd, end: oosEnd }, holdout: { start: oosEnd, end: period.end } };
}
function seeded(seed: number) { let value = seed >>> 0; return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function choice<T>(random: () => number, values: readonly T[]) { return values[Math.floor(random() * values.length)]!; }
function candidateConfig(input: ResearchRunInput, index: number): { config: StrategyConfig; family: string; rawAst: Record<string, unknown> } {
  const random = seeded(input.randomSeed + index * 97); const timeframe = input.triggerTimeframe; const direction = input.directions === "LONG" ? "LONG_ONLY" : input.directions === "SHORT" ? "SHORT_ONLY" : "LONG_AND_SHORT";
  const base = { exchange: "BINANCE" as const, market: "BINANCE_USDM_FUTURES" as const, symbols: [input.symbol], triggerTimeframe: timeframe, executionTimeframe: input.executionTimeframe, requiredTimeframes: [...new Set([timeframe, input.executionTimeframe])], directions: direction, stop: { type: "PERCENTAGE" as const, percentage: choice(random, [1, 1.5, 2, 3]) }, takeProfit: { type: "R_MULTIPLE" as const, multiple: choice(random, [1.25, 1.5, 2, 3]) }, sizing: { type: "FIXED_RISK" as const, riskPct: 1 }, leverage: { fixed: 1, maximum: 1, isolated: true }, costs: { makerFeePct: .02, takerFeePct: .04, entryFeeType: "TAKER" as const, exitFeeType: "TAKER" as const, slippageBps: 2, fundingMode: "NONE" as const, fixedFundingPct: 0, fillModel: "NEXT_OPEN" as const, sameBarPolicy: "WORST_CASE" as const } };
  const emaFast = choice(random, [10, 20, 30, 50]), emaSlow = choice(random, [50, 100, 200]), rsiPeriod = choice(random, [7, 14, 21]), threshold = choice(random, [30, 40, 50, 60, 70]);
  const emaCross = { left: { type: "indicator" as const, indicator: "ema", parameters: { period: Math.min(emaFast, emaSlow), source: "close" }, timeframe }, operator: "crosses_above" as const, right: { type: "indicator" as const, indicator: "ema", parameters: { period: Math.max(emaFast, emaSlow), source: "close" }, timeframe } };
  const rsi = { left: { type: "indicator" as const, indicator: "rsi", parameters: { period: rsiPeriod, source: "close" }, timeframe }, operator: ">" as const, right: { type: "constant" as const, value: threshold } };
  const reverse = { ...emaCross, operator: "crosses_below" as const };
  const useRsi = input.allowedIndicators.includes("rsi") && random() > .35;
  const long = useRsi ? { type: "group" as const, operator: "AND" as const, children: [emaCross, rsi] } : emaCross;
  const short = useRsi ? { type: "group" as const, operator: "AND" as const, children: [reverse, { ...rsi, operator: "<" as const, right: { type: "constant" as const, value: 100 - threshold } }] } : reverse;
  const config = strategyConfigSchema.parse({ ...base, longEntry: direction === "SHORT_ONLY" ? undefined : long, shortEntry: direction === "LONG_ONLY" ? undefined : short });
  return { config, family: useRsi ? "EMA_CROSS_RSI" : "EMA_CROSS", rawAst: { longEntry: config.longEntry, shortEntry: config.shortEntry, stop: config.stop, takeProfit: config.takeProfit, sizing: config.sizing } };
}
function metricSummary(simulated: Awaited<ReturnType<typeof simulate>>) { const metrics = verificationMetrics(simulated.trades, simulated.equity), initialEquity = simulated.equity[0]?.balance ?? 0, finalEquity = simulated.equity.at(-1)?.balance ?? initialEquity, interval = Math.max(1, Math.ceil(simulated.equity.length / 200)), equity = simulated.equity.filter((_, index) => index % interval === 0); if (simulated.equity.length && equity.at(-1) !== simulated.equity.at(-1)) equity.push(simulated.equity.at(-1)!); return { trades: metrics.tradeCount, netProfit: metrics.netProfit, return: metrics.netProfitPct, profitFactor: metrics.profitFactor, expectancy: metrics.expectancy, maxDrawdownPct: metrics.maxDrawdownPct, fees: metrics.totalFees, initialEquity, finalEquity, equity }; }
function passes(metrics: ReturnType<typeof metricSummary>, input: ResearchRunInput) { return Number(metrics.trades) >= input.minTrades && Number(metrics.profitFactor ?? 0) >= input.minProfitFactor && Number(metrics.maxDrawdownPct ?? Infinity) <= input.maxDrawdownPct; }

export class ResearchWorker {
  private timer: NodeJS.Timeout | null = null; private running = false;
  async start() { await researchRepository.recoverInterrupted(); this.timer = setInterval(() => void this.runOnce(), 500); await this.runOnce(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce() { if (this.running) return; const run = await researchRepository.claimNext(); if (!run) return; this.running = true; try { await this.execute(run); } catch (error) { await researchRepository.update(run.id, { status: "FAILED", health: "UNHEALTHY", stage: "FAILED", errorCode: "RESEARCH_FAILED", errorMessage: error instanceof Error ? error.message : "Unknown research error", completedAt: new Date() }); await researchRepository.log(run.id, "ERROR", "FAILED", "RUN_FAILED", error instanceof Error ? error.message : "Unknown research error"); } finally { this.running = false; } }
  private async execute(run: ReturnType<typeof researchRepository.get> extends infer T ? NonNullable<T> : never) {
    const input = researchRunSchema.parse(run.config), periods = splitResearchPeriod(input), frames = [...new Set([input.triggerTimeframe, input.executionTimeframe])]; const engine = new FeatureEngine(input.symbol, input.period.start, input.period.end, candleRepository).load(frames);
    if (!engine.candles(input.triggerTimeframe).length) throw new Error("No historical candles are available for the selected trigger timeframe");
    await researchRepository.log(run.id, "INFO", "GENERATING", "RUN_STARTED", "Research run started", { periods });
    const persisted = researchRepository.candidates(run.id, input.candidateBudget, 0), existingByIndex = new Map(persisted.map((candidate) => [candidate.generationIndex, candidate]));
    const finalists: Array<{ id: string; config: StrategyConfig; score: number }> = persisted.filter((candidate) => candidate.status === "FINALIST").map((candidate) => ({ id: candidate.id, config: strategyConfigSchema.parse(candidate.configuration), score: Number(candidate.score ?? 0) }));
    for (let index = 0; index < input.candidateBudget; index++) {
      const control = researchRepository.get(run.id); if (!control || control.status === "CANCELLING") { await researchRepository.update(run.id, { status: "CANCELLED", stage: "CANCELLED", completedAt: new Date() }); return; } if (control.status === "PAUSING") { await researchRepository.update(run.id, { status: "PAUSED", stage: "PAUSED" }); return; }
      if (existingByIndex.has(index)) continue;
      const generated = candidateConfig(input, index), normalized = normalizedCandidateHash(generated.rawAst), complexity = complexityOf(generated.rawAst);
      if (complexity > 8) { await researchRepository.insertCandidate({ researchRunId: run.id, generationIndex: index, status: "STRUCTURAL_REJECTED", family: generated.family, direction: input.directions, rawAst: generated.rawAst, normalizedAst: normalized.normalized, normalizedHash: normalized.hash, configuration: generated.config, complexityScore: complexity, rejectionStage: "STRUCTURAL", rejectionReason: "COMPLEXITY_LIMIT" }); await researchRepository.update(run.id, { structurallyRejectedCount: control.structurallyRejectedCount + 1 }); continue; }
      const structural = await researchRepository.insertCandidate({ researchRunId: run.id, generationIndex: index, status: "GENERATED", family: generated.family, direction: input.directions, rawAst: generated.rawAst, normalizedAst: normalized.normalized, normalizedHash: normalized.hash, configuration: generated.config, complexityScore: complexity });
      if (!structural) { await researchRepository.update(run.id, { duplicateCount: control.duplicateCount + 1, generatedCount: control.generatedCount + 1, progress: (index + 1) / input.candidateBudget * .5 }); continue; }
      const isMetrics = metricSummary(await simulate(generated.config, engine, input.initialBalance, undefined, () => researchRepository.get(run.id)?.status === "CANCELLING", {}, periods.is));
      let status = "IS_REJECTED", rejectionStage: string | null = "IS", rejectionReason: string | null = "QUALITY_FILTER", oosMetrics: ReturnType<typeof metricSummary> | null = null, score: number | null = null;
      if (passes(isMetrics, input)) { oosMetrics = metricSummary(await simulate(generated.config, engine, isMetrics.finalEquity, undefined, () => researchRepository.get(run.id)?.status === "CANCELLING", {}, periods.oos)); if (passes(oosMetrics, input)) { score = Number(oosMetrics.profitFactor ?? 0) * 100 + Number(oosMetrics.return ?? 0) - Number(oosMetrics.maxDrawdownPct ?? 0) - complexity * 2; status = "FINALIST"; rejectionStage = null; rejectionReason = null; finalists.push({ id: structural.id, config: generated.config, score }); } else { status = "OOS_REJECTED"; rejectionStage = "OOS"; } }
      await researchRepository.updateCandidate(structural.id, { status, metrics: { is: isMetrics, oos: oosMetrics }, score, rejectionStage, rejectionReason });
      await researchRepository.update(run.id, { stage: "OOS_SCREENING", progress: (index + 1) / input.candidateBudget * .75, generatedCount: control.generatedCount + 1, isTestedCount: control.isTestedCount + 1, isSurvivorCount: control.isSurvivorCount + (passes(isMetrics, input) ? 1 : 0), oosTestedCount: control.oosTestedCount + (oosMetrics ? 1 : 0), oosSurvivorCount: control.oosSurvivorCount + (status === "FINALIST" ? 1 : 0) });
    }
    const selected = finalists.sort((left, right) => right.score - left.score).slice(0, input.maximumHoldoutCandidates);
    await researchRepository.update(run.id, { stage: "HOLDOUT_EVALUATION", progress: .8, finalistCount: selected.length });
    for (const finalist of selected) { const candidate = researchRepository.candidate(finalist.id); if (!candidate) continue; const oos = candidate.metrics?.oos as { finalEquity?: unknown; equity?: Array<{ balance?: unknown }> } | undefined, oosFinalEquity = Number(oos?.finalEquity ?? oos?.equity?.at(-1)?.balance ?? input.initialBalance), holdout = metricSummary(await simulate(finalist.config, engine, Number.isFinite(oosFinalEquity) ? oosFinalEquity : input.initialBalance, undefined, () => researchRepository.get(run.id)?.status === "CANCELLING", {}, periods.holdout)); const status = passes(holdout, input) ? "COMPLETED" : "HOLDOUT_REJECTED"; await researchRepository.updateCandidate(finalist.id, { status, metrics: { ...candidate.metrics, holdout }, score: finalist.score, rejectionStage: status === "COMPLETED" ? null : "HOLDOUT", rejectionReason: status === "COMPLETED" ? null : "QUALITY_FILTER" }); }
    await researchRepository.update(run.id, { status: "COMPLETED", health: "HEALTHY", stage: "FINALIZING", progress: 1, holdoutEvaluated: true, holdoutTestedCount: selected.length, completedAt: new Date() }); await researchRepository.log(run.id, "INFO", "FINALIZING", "RUN_COMPLETED", "Research run completed", { finalists: selected.length });
  }
}
export const researchWorker = new ResearchWorker();
export function researchConfigHash(input: ResearchRunInput) { return createHash("sha256").update(canonicalJson(input)).digest("hex"); }
export function researchDatasetFingerprint(input: ResearchRunInput) { return dataFingerprint(input.symbol, [...new Set([input.triggerTimeframe, input.executionTimeframe])], input.period.start, input.period.end); }
