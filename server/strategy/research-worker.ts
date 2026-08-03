import { FeatureEngine } from "./feature-engine.js";
import { INDICATOR_REGISTRY_VERSION } from "./indicators.js";
import { verificationMetrics } from "./metrics.js";
import { canonicalJson, researchRunSchema, stageQuality, strategyConfigSchema, type ResearchRunInput, type StrategyConfig } from "./model.js";
import { normalizedCandidateHash, complexityOf } from "./research-normalization.js";
import { generateCandidate } from "./research-generator.js";
import { preflightCandidate, validateCandidateSemantics } from "./research-grammar.js";
import { researchRepository } from "./research-repository.js";
import { candleRepository } from "../db/repository.js";
import { dataFingerprint } from "./verification-worker.js";
import { simulate } from "./simulation.js";
import { createHash } from "node:crypto";

export const RESEARCH_ENGINE_VERSION = "2026.09.semantic-grammar.1";
export const RESEARCH_SPLITTER_VERSION = "2026.08.chronological.1";
const terminalCandidateStatuses = new Set(["STRUCTURAL_REJECTED", "IS_REJECTED", "OOS_REJECTED", "HOLDOUT_REJECTED", "COMPLETED", "PROMOTED", "PINNED", "REJECTED", "EVALUATION_FAILED"]);

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
export function candidateConfig(input: ResearchRunInput, index: number): { config: StrategyConfig; family: string; rawAst: Record<string, unknown> } { const generated = generateCandidate(input, index); return { config: generated.config, family: generated.family, rawAst: generated.rawAst }; }
function metricSummary(simulated: Awaited<ReturnType<typeof simulate>>) {
  const metrics = verificationMetrics(simulated.trades, simulated.equity), initialEquity = simulated.equity[0]?.balance ?? 0, finalEquity = simulated.equity.at(-1)?.balance ?? initialEquity, interval = Math.max(1, Math.ceil(simulated.equity.length / 200)), equity = simulated.equity.filter((_, index) => index % interval === 0);
  if (simulated.equity.length && equity.at(-1) !== simulated.equity.at(-1)) equity.push(simulated.equity.at(-1)!);
  return { trades: metrics.tradeCount, netProfit: metrics.netProfit, return: metrics.netProfitPct, profitFactor: metrics.grossLoss === 0 && metrics.grossProfit > 0 ? "INF" : metrics.profitFactor, expectancy: metrics.expectancy, maxDrawdownPct: metrics.maxDrawdownPct, fees: metrics.totalFees, grossProfit: metrics.grossProfit, grossLoss: metrics.grossLoss, winRate: metrics.winRate, averageWin: metrics.averageWin, averageLoss: metrics.averageLoss, totalFunding: metrics.totalFunding, totalSlippageImpact: metrics.totalSlippageImpact, initialEquity, finalEquity, equity, funnel: simulated.funnel, warnings: simulated.warnings };
}
function qualityFailures(metrics: ReturnType<typeof metricSummary>, input: ResearchRunInput, stage: "is" | "oos" | "holdout") {
  const gate = stageQuality(input, stage), failures: string[] = [];
  if (metrics.trades < gate.minTrades) failures.push(`${stage.toUpperCase()}_MIN_TRADES`);
  const pf = metrics.profitFactor === "INF" ? Infinity : Number(metrics.profitFactor ?? 0);
  if (!Number.isFinite(pf) && pf !== Infinity || pf < gate.minProfitFactor) failures.push(`${stage.toUpperCase()}_PROFIT_FACTOR`);
  if (Math.abs(Number(metrics.maxDrawdownPct ?? Infinity)) > gate.maxDrawdownPct) failures.push(`${stage.toUpperCase()}_MAX_DRAWDOWN`);
  return failures;
}

export class ResearchWorker {
  private timer: NodeJS.Timeout | null = null; private running = false;
  async start() { await researchRepository.recoverInterrupted(); this.timer = setInterval(() => void this.runOnce(), 500); void this.runOnce(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async runOnce() { if (this.running) return; const run = await researchRepository.claimNext(); if (!run) return; this.running = true; try { await this.execute(run); } catch (error) { await researchRepository.update(run.id, { status: "FAILED", health: "UNHEALTHY", stage: "FAILED", errorCode: "RESEARCH_FAILED", errorMessage: error instanceof Error ? error.message : "Unknown research error", completedAt: new Date() }); await researchRepository.log(run.id, "ERROR", "FAILED", "RUN_FAILED", error instanceof Error ? error.message : "Unknown research error"); } finally { this.running = false; } }
  private async execute(run: ReturnType<typeof researchRepository.get> extends infer T ? NonNullable<T> : never) {
    const input = researchRunSchema.parse(run.config), periods = splitResearchPeriod(input), frames = [...new Set([input.triggerTimeframe, input.executionTimeframe])];
    const engine = new FeatureEngine(input.symbol, input.period.start, input.period.end, candleRepository).load(frames);
    if (!engine.candles(input.triggerTimeframe).length) throw new Error("No historical candles are available for the selected trigger timeframe");
    const maxAttempts = input.maxGenerationAttempts ?? Math.max(input.candidateBudget * 10, input.candidateBudget + 25);
    await researchRepository.update(run.id, { grammarVersion: input.grammarVersion, generationPolicy: { maxAttempts, candidateBudget: input.candidateBudget, maxConditionsPerSide: input.maxConditionsPerSide }, validationPolicy: { qualityGates: input.qualityGates, preflight: "reference-period-signal-sanity-v1" }, deduplicationPolicy: { exact: "normalized_ast_sha256", semantic: "signal_fingerprint" }, costModel: { source: "strategy_configuration" } });
    await researchRepository.log(run.id, "INFO", "GENERATING", "RUN_STARTED", "Research run started", { periods, maxAttempts, candidateBudget: input.candidateBudget, indicatorCount: input.allowedIndicators.length });
    const persisted = researchRepository.candidates(run.id, 10_000, 0), seen = new Set(persisted.map((candidate) => candidate.normalizedHash)), semanticSeen = new Set(persisted.map((candidate) => candidate.semanticFingerprint).filter(Boolean) as string[]);
    const finalists: Array<{ id: string; config: StrategyConfig; score: number }> = persisted.filter((candidate) => candidate.status === "FINALIST").map((candidate) => ({ id: candidate.id, config: strategyConfigSchema.parse(candidate.configuration), score: Number(candidate.score ?? 0) }));
    const acceptedAlready = persisted.filter((candidate) => ["GENERATED", "IS_REJECTED", "OOS_REJECTED", "FINALIST", "COMPLETED", "PROMOTED", "PINNED", "HOLDOUT_REJECTED"].includes(candidate.status)).length;
    let acceptedCount = acceptedAlready, attempt = Math.max(run.generationAttemptCount, persisted.reduce((max, candidate) => Math.max(max, candidate.generationAttemptIndex ?? candidate.generationIndex + 1), 0)), staticRejected = run.staticRejectedCount, preflightRejected = run.preflightRejectedCount, exactDuplicates = run.exactDuplicateCount, semanticDuplicates = run.semanticDuplicateCount, isTested = run.isTestedCount, isSurvivor = run.isSurvivorCount, oosTested = run.oosTestedCount, oosSurvivor = run.oosSurvivorCount;
    while (acceptedCount < input.candidateBudget && attempt < maxAttempts) {
      const control = researchRepository.get(run.id); if (!control || control.status === "CANCELLING") { await researchRepository.update(run.id, { status: "CANCELLED", stage: "CANCELLED", completionReason: "CANCELLED_BY_USER", completedAt: new Date() }); return; } if (control.status === "PAUSING") { await researchRepository.update(run.id, { status: "PAUSED", stage: "PAUSED" }); return; }
      const generationIndex = attempt, generationAttemptIndex = attempt + 1; attempt++;
      await researchRepository.update(run.id, { generationAttemptCount: attempt, stage: "GENERATING", progress: Math.min(.45, acceptedCount / input.candidateBudget * .45) });
      let generated: ReturnType<typeof generateCandidate>;
      try { generated = generateCandidate(input, generationIndex); } catch (cause) { staticRejected++; await researchRepository.log(run.id, "WARN", "GENERATING", "STATIC_REJECTION", cause instanceof Error ? cause.message : "Candidate generation failed", { generationAttemptIndex }); await researchRepository.update(run.id, { staticRejectedCount: staticRejected, structurallyRejectedCount: staticRejected, generatedRawCount: attempt }); continue; }
      const normalized = normalizedCandidateHash(generated.rawAst), complexity = complexityOf(generated.rawAst);
      if (seen.has(normalized.hash)) { exactDuplicates++; await researchRepository.log(run.id, "INFO", "GENERATING", "EXACT_DUPLICATE", "Candidate matched an existing normalized AST", { generationAttemptIndex, normalizedHash: normalized.hash }); await researchRepository.update(run.id, { exactDuplicateCount: exactDuplicates, duplicateCount: exactDuplicates + semanticDuplicates, generatedRawCount: attempt }); continue; }
      if (semanticSeen.has(normalized.semanticFingerprint)) { semanticDuplicates++; await researchRepository.log(run.id, "INFO", "GENERATING", "SEMANTIC_DUPLICATE", "Candidate matched an existing semantic fingerprint", { generationAttemptIndex, semanticFingerprint: normalized.semanticFingerprint }); await researchRepository.update(run.id, { semanticDuplicateCount: semanticDuplicates, duplicateCount: exactDuplicates + semanticDuplicates, generatedRawCount: attempt }); continue; }
      const staticValidation = validateCandidateSemantics(generated.config);
      if (!staticValidation.valid || complexity > 12) { staticRejected++; await researchRepository.insertCandidate({ researchRunId: run.id, generationIndex, generationAttemptIndex, status: "STRUCTURAL_REJECTED", family: generated.family, direction: input.directions, rawAst: generated.rawAst, normalizedAst: normalized.normalized, normalizedHash: normalized.hash, semanticFingerprint: normalized.semanticFingerprint, configuration: generated.config, complexityScore: complexity, validationStatus: "INVALID", validationErrors: [...staticValidation.issues, ...(complexity > 12 ? [{ code: "COMPLEXITY_LIMIT", message: "Candidate complexity exceeds configured limit" }] : [])], rejectionStage: "STRUCTURAL", rejectionReason: staticValidation.errors.join("; ") || "COMPLEXITY_LIMIT", terminalReason: "STATIC_VALIDATION_FAILED", grammarVersion: input.grammarVersion, registryVersion: INDICATOR_REGISTRY_VERSION, generatorVersion: RESEARCH_ENGINE_VERSION }); seen.add(normalized.hash); semanticSeen.add(normalized.semanticFingerprint); await researchRepository.update(run.id, { staticRejectedCount: staticRejected, structurallyRejectedCount: staticRejected, generatedRawCount: attempt }); continue; }
      const preflight = preflightCandidate(generated.config, engine, periods.is);
      if (!preflight.accepted) { preflightRejected++; await researchRepository.insertCandidate({ researchRunId: run.id, generationIndex, generationAttemptIndex, status: "REJECTED", family: generated.family, direction: input.directions, rawAst: generated.rawAst, normalizedAst: normalized.normalized, normalizedHash: normalized.hash, semanticFingerprint: preflight.semanticFingerprint, configuration: generated.config, complexityScore: complexity, validationStatus: "PREFLIGHT_REJECTED", validationErrors: preflight.issues, preflightMetrics: preflight.stats, rejectionStage: "PREFLIGHT", rejectionReason: preflight.issues.map((issue) => issue.code).join(","), terminalReason: "PREFLIGHT_FAILED", grammarVersion: input.grammarVersion, registryVersion: INDICATOR_REGISTRY_VERSION, generatorVersion: RESEARCH_ENGINE_VERSION }); seen.add(normalized.hash); semanticSeen.add(preflight.semanticFingerprint); await researchRepository.update(run.id, { preflightRejectedCount: preflightRejected, generatedRawCount: attempt }); continue; }
      const structural = await researchRepository.insertCandidate({ researchRunId: run.id, generationIndex, generationAttemptIndex, status: "GENERATED", family: generated.family, direction: input.directions, rawAst: generated.rawAst, normalizedAst: normalized.normalized, normalizedHash: normalized.hash, semanticFingerprint: preflight.semanticFingerprint, configuration: generated.config, complexityScore: complexity, validationStatus: "VALID", preflightMetrics: preflight.stats, grammarVersion: input.grammarVersion, registryVersion: INDICATOR_REGISTRY_VERSION, generatorVersion: RESEARCH_ENGINE_VERSION });
      if (!structural) { exactDuplicates++; await researchRepository.update(run.id, { exactDuplicateCount: exactDuplicates, duplicateCount: exactDuplicates + semanticDuplicates, generatedRawCount: attempt }); continue; }
      seen.add(normalized.hash); semanticSeen.add(preflight.semanticFingerprint); acceptedCount++;
      const isMetrics = metricSummary(await simulate(generated.config, engine, input.initialBalance, undefined, () => researchRepository.get(run.id)?.status === "CANCELLING", {}, periods.is)); isTested++;
      const isFailures = qualityFailures(isMetrics, input, "is"); const stageReasons: Record<string, unknown> = { is: isFailures }; let status = "IS_REJECTED", rejectionStage: string | null = "IS", rejectionReason: string | null = isFailures.join(",") || null, oosMetrics: ReturnType<typeof metricSummary> | null = null, score: number | null = null;
      if (!isFailures.length) { isSurvivor++; oosMetrics = metricSummary(await simulate(generated.config, engine, isMetrics.finalEquity, undefined, () => researchRepository.get(run.id)?.status === "CANCELLING", {}, { ...periods.oos, startExclusive: true })); oosTested++; const oosFailures = qualityFailures(oosMetrics, input, "oos"); stageReasons.oos = oosFailures; if (!oosFailures.length) { oosSurvivor++; score = Number(oosMetrics.profitFactor ?? 0) * 100 + Number(oosMetrics.return ?? 0) - Math.abs(Number(oosMetrics.maxDrawdownPct ?? 0)) - complexity * 2; status = "FINALIST"; rejectionStage = null; rejectionReason = null; finalists.push({ id: structural.id, config: generated.config, score }); } else { status = "OOS_REJECTED"; rejectionStage = "OOS"; rejectionReason = oosFailures.join(","); } }
      await researchRepository.updateCandidate(structural.id, { status, metrics: { is: isMetrics, oos: oosMetrics }, score, rejectionStage, rejectionReason, stageRejectionReasons: stageReasons, terminalReason: status === "FINALIST" ? null : rejectionReason });
      await researchRepository.update(run.id, { stage: "OOS_SCREENING", progress: .45 + acceptedCount / input.candidateBudget * .3, generatedCount: acceptedCount, generatedRawCount: attempt, acceptedCandidateCount: acceptedCount, isTestedCount: isTested, isSurvivorCount: isSurvivor, oosTestedCount: oosTested, oosSurvivorCount: oosSurvivor, duplicateCount: exactDuplicates + semanticDuplicates, exactDuplicateCount: exactDuplicates, semanticDuplicateCount: semanticDuplicates });
    }
    const generationExhausted = acceptedCount < input.candidateBudget, generationReason = generationExhausted ? `Generated ${acceptedCount} valid unique candidates after ${attempt} attempts; requested ${input.candidateBudget}.` : null;
    const selected = finalists.sort((left, right) => right.score - left.score).slice(0, input.maximumHoldoutCandidates);
    const selectedIds = new Set(selected.map((item) => item.id));
    for (const finalist of finalists.filter((item) => !selectedIds.has(item.id))) await researchRepository.updateCandidate(finalist.id, { status: "REJECTED", rejectionStage: "HOLDOUT", rejectionReason: "MAXIMUM_HOLDOUT_CANDIDATES", terminalReason: "NOT_SELECTED_FOR_HOLDOUT" });
    await researchRepository.update(run.id, { stage: "HOLDOUT_EVALUATION", progress: .8, finalistCount: selected.length });
    for (const finalist of selected) { const candidate = researchRepository.candidate(finalist.id); if (!candidate) continue; const oos = candidate.metrics?.oos as { finalEquity?: unknown; equity?: Array<{ balance?: unknown }> } | undefined, oosFinalEquity = Number(oos?.finalEquity ?? oos?.equity?.at(-1)?.balance ?? input.initialBalance), holdout = metricSummary(await simulate(finalist.config, engine, Number.isFinite(oosFinalEquity) ? oosFinalEquity : input.initialBalance, undefined, () => researchRepository.get(run.id)?.status === "CANCELLING", {}, { ...periods.holdout, startExclusive: true })); const failures = qualityFailures(holdout, input, "holdout"), status = failures.length ? "HOLDOUT_REJECTED" : "COMPLETED"; await researchRepository.updateCandidate(finalist.id, { status, metrics: { ...candidate.metrics, holdout }, score: finalist.score, rejectionStage: failures.length ? "HOLDOUT" : null, rejectionReason: failures.length ? failures.join(",") : null, stageRejectionReasons: { ...(candidate.stageRejectionReasons ?? {}), holdout: failures }, terminalReason: failures.length ? failures.join(",") : "HOLDOUT_CONFIRMED" }); }
    const reconciliation = await researchRepository.reconcile(run.id);
    if (reconciliation.transient) for (const candidate of researchRepository.candidates(run.id, 10_000, 0).filter((item) => !terminalCandidateStatuses.has(item.status))) await researchRepository.updateCandidate(candidate.id, { status: "EVALUATION_FAILED", rejectionStage: "FINALIZATION", rejectionReason: "UNRECONCILED_TRANSIENT_STATE", terminalReason: "FINALIZATION_RECONCILIATION" });
    await researchRepository.reconcile(run.id);
    await researchRepository.update(run.id, { status: "COMPLETED", health: "HEALTHY", stage: "FINALIZING", progress: 1, holdoutEvaluated: true, holdoutTestedCount: selected.length, generationExhausted, generationExhaustionReason: generationReason, completionReason: generationReason ?? "REQUESTED_BUDGET_EVALUATED", completedAt: new Date() });
    await researchRepository.log(run.id, "INFO", "FINALIZING", generationExhausted ? "RUN_PARTIAL_COMPLETED" : "RUN_COMPLETED", generationExhausted ? generationReason! : "Research run completed", { finalists: selected.length, acceptedCandidates: acceptedCount, requestedCandidates: input.candidateBudget, attempts: attempt });
  }
}
export const researchWorker = new ResearchWorker();
export function researchConfigHash(input: ResearchRunInput) { return createHash("sha256").update(canonicalJson(input)).digest("hex"); }
export function researchDatasetFingerprint(input: ResearchRunInput) { return dataFingerprint(input.symbol, [...new Set([input.triggerTimeframe, input.executionTimeframe])], input.period.start, input.period.end); }
