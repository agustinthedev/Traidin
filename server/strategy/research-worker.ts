import { FeatureEngine } from "./feature-engine.js";
import {
  INDICATOR_REGISTRY_VERSION,
  indicatorRegistry,
  validateIndicator,
} from "./indicators.js";
import { verificationMetrics } from "./metrics.js";
import {
  canonicalJson,
  researchRunSchema,
  stageQuality,
  strategyConfigSchema,
  type ResearchRunInput,
  type StrategyConfig,
  TIMEFRAME_MINUTES,
} from "./model.js";
import {
  normalizedCandidateHash,
  complexityOf,
} from "./research-normalization.js";
import { generateCandidate } from "./research-generator.js";
import {
  preflightCandidate,
  validateCandidateSemantics,
} from "./research-grammar.js";
import {
  researchRepository,
  StaleWorkerError,
  type WorkerOwnership,
} from "./research-repository.js";
import { candleRepository } from "../db/repository.js";
import { dataFingerprint } from "./verification-worker.js";
import { simulate } from "./simulation.js";
import { createHash } from "node:crypto";
import {
  RESEARCH_FORMATTER_VERSION,
  describeCandidate,
} from "./research-description.js";
import { analyzeCandidateAst } from "./structural-analysis.js";

export const RESEARCH_ENGINE_VERSION = "2026.09.semantic-grammar.1";
export const RESEARCH_SPLITTER_VERSION = "2026.08.chronological.1";
const terminalCandidateStatuses = new Set([
  "STRUCTURAL_REJECTED",
  "IS_REJECTED",
  "OOS_REJECTED",
  "HOLDOUT_REJECTED",
  "COMPLETED",
  "PROMOTED",
  "PINNED",
  "REJECTED",
  "EVALUATION_FAILED",
]);

export type ResearchTerminalOutcome =
  | "PENDING"
  | "COMPLETED"
  | "PARTIAL"
  | "EXHAUSTED"
  | "FAILED"
  | "CANCELLED"
  | "LEGACY";
export function resolveResearchTerminalOutcome(
  acceptedCount: number,
  candidateBudget: number,
  generationExhausted: boolean,
): Exclude<
  ResearchTerminalOutcome,
  "PENDING" | "FAILED" | "CANCELLED" | "LEGACY"
> {
  if (!generationExhausted && acceptedCount >= candidateBudget)
    return "COMPLETED";
  return acceptedCount > 0 ? "PARTIAL" : "EXHAUSTED";
}

type Periods = {
  is: { start: Date; end: Date };
  oos: { start: Date; end: Date };
  holdout: { start: Date; end: Date };
};
export function splitResearchPeriod(input: ResearchRunInput): Periods {
  const period = input.period;
  if (period.end <= period.start)
    throw new Error("The total range must end after its start");
  if (period.mode === "MANUAL") {
    if (
      !period.isStart ||
      !period.isEnd ||
      !period.oosStart ||
      !period.oosEnd ||
      !period.holdoutStart ||
      !period.holdoutEnd
    )
      throw new Error("Manual periods require IS, OOS and holdout boundaries");
    const values = [
      period.isStart,
      period.isEnd,
      period.oosStart,
      period.oosEnd,
      period.holdoutStart,
      period.holdoutEnd,
    ];
    if (values.some((value, index) => index > 0 && value <= values[index - 1]))
      throw new Error(
        "Research periods must be chronological and non-overlapping",
      );
    return {
      is: { start: period.isStart, end: period.isEnd },
      oos: { start: period.oosStart, end: period.oosEnd },
      holdout: { start: period.holdoutStart, end: period.holdoutEnd },
    };
  }
  const ratios =
    period.policy === "LOW_FREQUENCY"
      ? [0.65, 0.2, 0.15]
      : period.policy === "INTRADAY"
        ? [0.55, 0.25, 0.2]
        : [0.6, 0.2, 0.2];
  const total = period.end.getTime() - period.start.getTime(),
    isEnd = new Date(period.start.getTime() + total * ratios[0]),
    oosEnd = new Date(isEnd.getTime() + total * ratios[1]);
  return {
    is: { start: period.start, end: isEnd },
    oos: { start: isEnd, end: oosEnd },
    holdout: { start: oosEnd, end: period.end },
  };
}
export function candidateConfig(
  input: ResearchRunInput,
  index: number,
): { config: StrategyConfig; family: string; rawAst: Record<string, unknown> } {
  const generated = generateCandidate(input, index);
  return {
    config: generated.config,
    family: generated.family,
    rawAst: generated.rawAst,
  };
}
function metricSummary(simulated: Awaited<ReturnType<typeof simulate>>) {
  const metrics = verificationMetrics(simulated.trades, simulated.equity),
    initialEquity = simulated.equity[0]?.balance ?? 0,
    finalEquity = simulated.equity.at(-1)?.balance ?? initialEquity,
    interval = Math.max(1, Math.ceil(simulated.equity.length / 200)),
    equity = simulated.equity.filter((_, index) => index % interval === 0);
  if (simulated.equity.length && equity.at(-1) !== simulated.equity.at(-1))
    equity.push(simulated.equity.at(-1)!);
  return {
    trades: metrics.tradeCount,
    netProfit: metrics.netProfit,
    return: metrics.netProfitPct,
    profitFactor:
      metrics.grossLoss === 0 && metrics.grossProfit > 0
        ? "INF"
        : metrics.profitFactor,
    expectancy: metrics.expectancy,
    maxDrawdownPct: metrics.maxDrawdownPct,
    fees: metrics.totalFees,
    grossProfit: metrics.grossProfit,
    grossLoss: metrics.grossLoss,
    winRate: metrics.winRate,
    averageWin: metrics.averageWin,
    averageLoss: metrics.averageLoss,
    totalFunding: metrics.totalFunding,
    totalSlippageImpact: metrics.totalSlippageImpact,
    initialEquity,
    finalEquity,
    equity,
    funnel: simulated.funnel,
    warnings: simulated.warnings,
  };
}
function qualityFailures(
  metrics: ReturnType<typeof metricSummary>,
  input: ResearchRunInput,
  stage: "is" | "oos" | "holdout",
) {
  const gate = stageQuality(input, stage),
    failures: string[] = [];
  if (metrics.trades < gate.minTrades)
    failures.push(`${stage.toUpperCase()}_MIN_TRADES`);
  const pf =
    metrics.profitFactor === "INF"
      ? Infinity
      : Number(metrics.profitFactor ?? 0);
  if ((!Number.isFinite(pf) && pf !== Infinity) || pf < gate.minProfitFactor)
    failures.push(`${stage.toUpperCase()}_PROFIT_FACTOR`);
  if (
    Math.abs(Number(metrics.maxDrawdownPct ?? Infinity)) > gate.maxDrawdownPct
  )
    failures.push(`${stage.toUpperCase()}_MAX_DRAWDOWN`);
  return failures;
}

export class ResearchWorker {
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private running = false;
  private staleClaim = false;
  constructor(
    private readonly workerId = process.env.TREIDIN_RESEARCH_WORKER_ID ??
      `research-worker-${process.pid}`,
  ) {}
  async start() {
    await researchRepository.recoverStaleLeases();
    this.timer = setInterval(() => void this.runOnce(), 500);
    void this.runOnce();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
  }
  async runOnce() {
    if (this.running) return;
    const run = await researchRepository.claimNext(this.workerId);
    if (!run) return;
    this.running = true;
    this.staleClaim = false;
    const claimToken = run.claimToken;
    if (!claimToken)
      throw new Error("Research Run claim token was not persisted");
    const ownership: WorkerOwnership = {
      researchRunId: run.id,
      workerId: this.workerId,
      claimToken,
    };
    researchRepository.setExecutionOwnership(ownership);
    this.heartbeatTimer = setInterval(() => {
      void researchRepository
        .heartbeat(run.id, claimToken, {
          stage: run.stage,
        })
        .catch((error) => {
          if (error instanceof StaleWorkerError) this.staleClaim = true;
        });
    }, 10_000);
    try {
      await this.execute(run, claimToken);
    } catch (error) {
      if (error instanceof StaleWorkerError) {
        // The lease/claim changed.  Never let a stale worker overwrite the new owner.
        return;
      }
      const message =
        error instanceof Error ? error.message : "Unknown research error";
      await researchRepository.update(run.id, {
        status: "FAILED",
        health: "UNHEALTHY",
        stage: "FAILED",
        terminalOutcome: "FAILED",
        errorCode: "RESEARCH_FAILED",
        errorMessage: message,
        workerFailureCode: "RESEARCH_FAILED",
        workerFailureMessage: message,
        completionMessage: "Research Run failed before normal completion.",
        terminalPersisted: true,
        completedAt: new Date(),
        leaseExpiresAt: null,
      });
      await researchRepository.log(
        run.id,
        "ERROR",
        "FAILED",
        "RUN_FAILED",
        message,
      );
    } finally {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      researchRepository.clearExecutionOwnership(run.id, claimToken);
      this.running = false;
    }
  }
  private async execute(
    run: ReturnType<typeof researchRepository.get> extends infer T
      ? NonNullable<T>
      : never,
    claimToken: string,
  ) {
    const input = researchRunSchema.parse(run.config),
      periods = splitResearchPeriod(input),
      frames = [...new Set([input.triggerTimeframe, input.executionTimeframe])];
    const warmupBars = requiredResearchWarmup(input),
      warmupStart = new Date(
        Math.min(
          ...Object.entries(warmupBars).map(
            ([timeframe, bars]) =>
              input.period.start.getTime() -
              (TIMEFRAME_MINUTES[timeframe as keyof typeof TIMEFRAME_MINUTES] ??
                1) *
                60_000 *
                bars,
          ),
        ),
      );
    const engine = new FeatureEngine(
      input.symbol,
      warmupStart,
      input.period.end,
      candleRepository,
    ).load(frames);
    if (!engine.candles(input.triggerTimeframe).length)
      throw new Error(
        "No historical candles are available for the selected trigger timeframe",
      );
    const maxAttempts =
      input.maxGenerationAttempts ??
      Math.max(input.candidateBudget * 10, input.candidateBudget + 25);
    await researchRepository.update(run.id, {
      maxGenerationAttempts: maxAttempts,
      grammarVersion: input.grammarVersion,
      generationPolicy: {
        maxAttempts,
        candidateBudget: input.candidateBudget,
        maxConditionsPerSide: input.maxConditionsPerSide,
      },
      validationPolicy: {
        qualityGates: input.qualityGates,
        preflight: "reference-period-signal-sanity-v2",
      },
      deduplicationPolicy: {
        exact: "normalized_ast_sha256",
        semantic: "signal_fingerprint",
      },
      costModel: { source: "strategy_configuration" },
      warmupPolicyVersion: "2026.09.context-before-evaluation.1",
    });
    await researchRepository.log(
      run.id,
      "INFO",
      "GENERATING",
      "RUN_STARTED",
      "Research run started",
      {
        periods,
        maxAttempts,
        candidateBudget: input.candidateBudget,
        indicatorCount: input.allowedIndicators.length,
        warmupBars,
        warmupContextStart: warmupStart.toISOString(),
      },
    );
    const persisted = researchRepository.candidates(run.id, 10_000, 0),
      seen = new Set(persisted.map((candidate) => candidate.normalizedHash)),
      semanticSeen = new Set(
        persisted
          .map((candidate) => candidate.semanticFingerprint)
          .filter(Boolean) as string[],
      );
    const finalists: Array<{
      id: string;
      config: StrategyConfig;
      score: number;
    }> = persisted
      .filter((candidate) => candidate.status === "FINALIST")
      .map((candidate) => ({
        id: candidate.id,
        config: strategyConfigSchema.parse(candidate.configuration),
        score: Number(candidate.score ?? 0),
      }));
    const acceptedAlready = persisted.filter((candidate) =>
      [
        "GENERATED",
        "IS_REJECTED",
        "OOS_REJECTED",
        "FINALIST",
        "COMPLETED",
        "PROMOTED",
        "PINNED",
        "HOLDOUT_REJECTED",
      ].includes(candidate.status),
    ).length;
    let acceptedCount = acceptedAlready,
      attempt = Math.max(
        run.generationAttemptCount,
        persisted.reduce(
          (max, candidate) =>
            Math.max(
              max,
              candidate.generationAttemptIndex ?? candidate.generationIndex + 1,
            ),
          0,
        ),
      ),
      staticRejected = run.staticRejectedCount,
      generationErrors = run.generationErrorCount,
      rawGenerated = run.generatedRawCount,
      preflightRejected = run.preflightRejectedCount,
      exactDuplicates = run.exactDuplicateCount,
      semanticDuplicates = run.semanticDuplicateCount,
      isTested = run.isTestedCount,
      isSurvivor = run.isSurvivorCount,
      oosTested = run.oosTestedCount,
      oosSurvivor = run.oosSurvivorCount,
      rejectedInIs = run.rejectedInIsCount,
      rejectedInOos = run.rejectedInOosCount,
      advancedToOos = run.advancedToOosCount,
      advancedToHoldout = run.advancedToHoldoutCount,
      evaluatedInIs = run.evaluatedInIsCount,
      acceptedValidUnique = run.acceptedValidUniqueCount,
      sharedFilterCount = run.sharedFilterCount,
      multiConditionCount = run.multiConditionCount,
      crossFamilyCount = run.crossFamilyCount;
    let rejectedInHoldout = run.rejectedInHoldoutCount;
    const templateCounts: Record<string, number> = {
        ...(run.templateCounts as Record<string, number>),
      },
      predicateRoleCounts: Record<string, number> = {
        ...(run.predicateRoleCounts as Record<string, number>),
      };
    const recordAttempt = (
      result: string,
      details: {
        rejectionCode?: string;
        rejectionMessage?: string;
        candidateId?: string | null;
        duplicateOfCandidateId?: string | null;
        selectedIndicators?: unknown;
        selectedTemplateIds?: unknown;
        diagnostic?: unknown;
      } = {},
    ) =>
      researchRepository.insertGenerationAttempt({
        researchRunId: run.id,
        attemptIndex: attempt,
        deterministicSeed: input.randomSeed + (attempt - 1) * 97,
        rngPosition: { attempt },
        generatorVersion: RESEARCH_ENGINE_VERSION,
        grammarVersion: input.grammarVersion,
        registryVersion: INDICATOR_REGISTRY_VERSION,
        selectedIndicators: details.selectedIndicators ?? [],
        selectedTemplateIds: details.selectedTemplateIds ?? [],
        result,
        rejectionCode: details.rejectionCode,
        rejectionMessage: details.rejectionMessage,
        candidateId: details.candidateId,
        duplicateOfCandidateId: details.duplicateOfCandidateId,
        diagnostic: details.diagnostic,
        durationMs: undefined,
      });
    while (acceptedCount < input.candidateBudget && attempt < maxAttempts) {
      if (this.staleClaim)
        throw new StaleWorkerError(
          { researchRunId: run.id, workerId: this.workerId, claimToken },
          "execution",
        );
      const control = researchRepository.get(run.id);
      if (!control || control.status === "CANCELLING") {
        await researchRepository.update(run.id, {
          status: "CANCELLED",
          health: "DEGRADED",
          stage: "CANCELLED",
          terminalOutcome: "CANCELLED",
          completionReason: "CANCELLED_BY_USER",
          cancelledCount: 1,
          terminalPersisted: true,
          completionMessage: "Research Run cancelled by the user.",
          leaseExpiresAt: null,
          completedAt: new Date(),
        });
        return;
      }
      if (control.status === "PAUSING") {
        await researchRepository.update(run.id, {
          status: "PAUSED",
          stage: "PAUSED",
          leaseExpiresAt: null,
        });
        return;
      }
      const generationIndex = attempt,
        generationAttemptIndex = attempt + 1;
      attempt++;
      await researchRepository.heartbeat(run.id, claimToken, {
        stage: "GENERATING",
        progress: Math.min(
          0.45,
          (acceptedCount / input.candidateBudget) * 0.45,
        ),
      });
      await researchRepository.update(run.id, {
        generationAttemptCount: attempt,
        stage: "GENERATING",
        progress: Math.min(
          0.45,
          (acceptedCount / input.candidateBudget) * 0.45,
        ),
      });
      let generated: ReturnType<typeof generateCandidate>;
      try {
        generated = generateCandidate(input, generationIndex);
      } catch (cause) {
        generationErrors++;
        await recordAttempt("GENERATION_ERROR", {
          rejectionCode: "GENERATION_ERROR",
          rejectionMessage:
            cause instanceof Error
              ? cause.message
              : "Candidate generation failed",
        });
        await researchRepository.log(
          run.id,
          "WARN",
          "GENERATING",
          "STATIC_REJECTION",
          cause instanceof Error
            ? cause.message
            : "Candidate generation failed",
          { generationAttemptIndex },
        );
        await researchRepository.update(run.id, {
          generationErrorCount: generationErrors,
          generationAttemptCount: attempt,
          generatedRawCount: rawGenerated,
        });
        continue;
      }
      rawGenerated++;
      const generatedTemplateIds = (generated.rawAst.templateIds as
          string[] | undefined) ?? [generated.template],
        generatedPredicates =
          (generated.rawAst.predicateMetadata as
            Array<{ role?: string; shared?: boolean }> | undefined) ?? [];
      for (const templateId of generatedTemplateIds)
        templateCounts[templateId] = (templateCounts[templateId] ?? 0) + 1;
      for (const predicate of generatedPredicates)
        if (predicate.role)
          predicateRoleCounts[predicate.role] =
            (predicateRoleCounts[predicate.role] ?? 0) + 1;
      if (generatedPredicates.some((predicate) => predicate.shared))
        sharedFilterCount++;
      if (
        generatedPredicates.length > 1 ||
        complexityOf(generated.rawAst.longEntry) > 1 ||
        complexityOf(generated.rawAst.shortEntry) > 1
      )
        multiConditionCount++;
      if (generated.indicators.length > 1) crossFamilyCount++;
      const normalized = normalizedCandidateHash(generated.rawAst),
        complexity = complexityOf(generated.rawAst),
        structuralAnalysis = analyzeCandidateAst(normalized.normalized),
        structurallySimplifiedConfig = strategyConfigSchema.parse({
          ...generated.config,
          longEntry: (structuralAnalysis.simplifiedAst.longEntry ??
            generated.config.longEntry) as StrategyConfig["longEntry"],
          shortEntry: (structuralAnalysis.simplifiedAst.shortEntry ??
            generated.config.shortEntry) as StrategyConfig["shortEntry"],
        }),
        humanDescription = describeCandidate(
          normalized.normalized,
          structurallySimplifiedConfig,
        ),
        templateMetadata = {
          templateIds: (generated.rawAst.templateIds as
            string[] | undefined) ?? [generated.template],
          templateVersions:
            (generated.rawAst.templateVersions as
              Record<string, string> | undefined) ?? {},
          predicateMetadata:
            (generated.rawAst.predicateMetadata as unknown[] | undefined) ?? [],
          structuralValidation: structuralAnalysis.accepted
            ? "VALID"
            : "REJECTED",
          structuralActions: structuralAnalysis.actions,
          simplifiedNormalizedHash: structuralAnalysis.simplifiedNormalizedHash,
          simplifiedNormalizedAst: structuralAnalysis.simplifiedAst,
        };
      if (seen.has(normalized.hash)) {
        exactDuplicates++;
        const duplicateOf = researchRepository.findByFingerprint(
          run.id,
          normalized.hash,
        );
        await researchRepository.log(
          run.id,
          "INFO",
          "GENERATING",
          "EXACT_DUPLICATE",
          "Candidate matched an existing normalized AST",
          {
            generationAttemptIndex,
            normalizedHash: normalized.hash,
            duplicateOfCandidateId: duplicateOf?.id ?? null,
          },
        );
        await researchRepository.update(run.id, {
          exactDuplicateCount: exactDuplicates,
          duplicateCount: exactDuplicates + semanticDuplicates,
          generatedRawCount: rawGenerated,
        });
        await recordAttempt("EXACT_DUPLICATE", {
          rejectionCode: "EXACT_DUPLICATE",
          rejectionMessage: "Candidate matched an existing normalized AST",
          duplicateOfCandidateId: duplicateOf?.id,
          selectedIndicators: generated.indicators,
          selectedTemplateIds: generated.rawAst.templateIds,
        });
        continue;
      }
      const staticValidation = validateCandidateSemantics(
        structurallySimplifiedConfig,
      );
      if (
        !structuralAnalysis.accepted ||
        !staticValidation.valid ||
        complexity > 12
      ) {
        staticRejected++;
        await researchRepository.insertCandidate({
          researchRunId: run.id,
          generationIndex,
          generationAttemptIndex,
          status: "STRUCTURAL_REJECTED",
          family: generated.family,
          direction: input.directions,
          rawAst: generated.rawAst,
          normalizedAst: normalized.normalized,
          normalizedHash: normalized.hash,
          semanticFingerprint: normalized.semanticFingerprint,
          configuration: structurallySimplifiedConfig,
          complexityScore: complexity,
          validationStatus: "INVALID",
          validationErrors: [
            ...(structuralAnalysis.rejectionMessage
              ? [
                  {
                    code:
                      structuralAnalysis.rejectionCode ?? "STRUCTURAL_REJECTED",
                    message: structuralAnalysis.rejectionMessage,
                  },
                ]
              : []),
            ...staticValidation.issues,
            ...(complexity > 12
              ? [
                  {
                    code: "COMPLEXITY_LIMIT",
                    message: "Candidate complexity exceeds configured limit",
                  },
                ]
              : []),
          ],
          rejectionStage: "STRUCTURAL",
          rejectionReason:
            structuralAnalysis.rejectionMessage ??
            (staticValidation.errors.join("; ") || "COMPLEXITY_LIMIT"),
          terminalReason: "STATIC_VALIDATION_FAILED",
          humanDescription,
          formatterVersion: RESEARCH_FORMATTER_VERSION,
          grammarVersion: input.grammarVersion,
          registryVersion: INDICATOR_REGISTRY_VERSION,
          generatorVersion: RESEARCH_ENGINE_VERSION,
          ...templateMetadata,
        });
        seen.add(normalized.hash);
        semanticSeen.add(normalized.semanticFingerprint);
        await researchRepository.update(run.id, {
          staticRejectedCount: staticRejected,
          structurallyRejectedCount: staticRejected,
          generatedRawCount: rawGenerated,
        });
        await recordAttempt("STATIC_REJECTED", {
          rejectionCode:
            structuralAnalysis.rejectionCode ?? staticValidation.errors[0],
          rejectionMessage:
            structuralAnalysis.rejectionMessage ??
            staticValidation.errors.join("; "),
          selectedIndicators: generated.indicators,
          selectedTemplateIds: generated.rawAst.templateIds,
        });
        continue;
      }
      const preflight = preflightCandidate(
        structurallySimplifiedConfig,
        engine,
        periods.is,
      );
      if (!preflight.accepted) {
        preflightRejected++;
        await researchRepository.insertCandidate({
          researchRunId: run.id,
          generationIndex,
          generationAttemptIndex,
          status: "REJECTED",
          family: generated.family,
          direction: input.directions,
          rawAst: generated.rawAst,
          normalizedAst: normalized.normalized,
          normalizedHash: normalized.hash,
          semanticFingerprint: preflight.semanticFingerprint,
          configuration: structurallySimplifiedConfig,
          complexityScore: complexity,
          validationStatus: "PREFLIGHT_REJECTED",
          validationErrors: preflight.issues,
          preflightMetrics: preflight.stats,
          preflightDiagnostics: preflight.diagnostics,
          rejectionStage: "PREFLIGHT",
          rejectionReason: preflight.issues
            .map((issue) => issue.code)
            .join(","),
          terminalReason: "PREFLIGHT_FAILED",
          humanDescription,
          formatterVersion: RESEARCH_FORMATTER_VERSION,
          grammarVersion: input.grammarVersion,
          registryVersion: INDICATOR_REGISTRY_VERSION,
          generatorVersion: RESEARCH_ENGINE_VERSION,
          ...templateMetadata,
        });
        seen.add(normalized.hash);
        semanticSeen.add(preflight.semanticFingerprint);
        await researchRepository.update(run.id, {
          preflightRejectedCount: preflightRejected,
          generatedRawCount: rawGenerated,
        });
        await recordAttempt("PREFLIGHT_REJECTED", {
          rejectionCode: "PREFLIGHT_REJECTED",
          rejectionMessage: preflight.issues
            .map((issue) => issue.code)
            .join(","),
          selectedIndicators: generated.indicators,
          selectedTemplateIds: generated.rawAst.templateIds,
        });
        continue;
      }
      if (semanticSeen.has(preflight.semanticFingerprint)) {
        semanticDuplicates++;
        const duplicateOf = researchRepository.findByFingerprint(
          run.id,
          preflight.semanticFingerprint,
        );
        await researchRepository.insertCandidate({
          researchRunId: run.id,
          generationIndex,
          generationAttemptIndex,
          status: "REJECTED",
          family: generated.family,
          direction: input.directions,
          rawAst: generated.rawAst,
          normalizedAst: normalized.normalized,
          normalizedHash: normalized.hash,
          semanticFingerprint: preflight.semanticFingerprint,
          configuration: structurallySimplifiedConfig,
          complexityScore: complexity,
          validationStatus: "DUPLICATE",
          validationErrors: [
            {
              code: "SEMANTIC_DUPLICATE",
              message:
                "Candidate produces the same long/short signal series as an existing candidate",
            },
          ],
          preflightMetrics: preflight.stats,
          preflightDiagnostics: preflight.diagnostics,
          rejectionStage: "DEDUPLICATION",
          rejectionReason: "SEMANTIC_DUPLICATE",
          duplicateOfCandidateId: duplicateOf?.id ?? null,
          terminalReason: "DUPLICATE_OF_EXISTING_SIGNAL",
          humanDescription,
          formatterVersion: RESEARCH_FORMATTER_VERSION,
          grammarVersion: input.grammarVersion,
          registryVersion: INDICATOR_REGISTRY_VERSION,
          generatorVersion: RESEARCH_ENGINE_VERSION,
          ...templateMetadata,
        });
        seen.add(normalized.hash);
        await researchRepository.log(
          run.id,
          "INFO",
          "GENERATING",
          "SEMANTIC_DUPLICATE",
          "Candidate matched an existing signal fingerprint",
          {
            generationAttemptIndex,
            semanticFingerprint: preflight.semanticFingerprint,
            duplicateOfCandidateId: duplicateOf?.id ?? null,
          },
        );
        await researchRepository.update(run.id, {
          semanticDuplicateCount: semanticDuplicates,
          duplicateCount: exactDuplicates + semanticDuplicates,
          generatedRawCount: rawGenerated,
        });
        await recordAttempt("SEMANTIC_DUPLICATE", {
          rejectionCode: "SEMANTIC_DUPLICATE",
          rejectionMessage: "Candidate matched an existing signal fingerprint",
          duplicateOfCandidateId: duplicateOf?.id,
          selectedIndicators: generated.indicators,
          selectedTemplateIds: generated.rawAst.templateIds,
        });
        continue;
      }
      const structural = await researchRepository.insertCandidate({
        researchRunId: run.id,
        generationIndex,
        generationAttemptIndex,
        status: "GENERATED",
        family: generated.family,
        direction: input.directions,
        rawAst: generated.rawAst,
        normalizedAst: normalized.normalized,
        normalizedHash: normalized.hash,
        semanticFingerprint: preflight.semanticFingerprint,
        configuration: structurallySimplifiedConfig,
        complexityScore: complexity,
        validationStatus: "VALID",
        preflightMetrics: preflight.stats,
        preflightDiagnostics: preflight.diagnostics,
        humanDescription,
        formatterVersion: RESEARCH_FORMATTER_VERSION,
        grammarVersion: input.grammarVersion,
        registryVersion: INDICATOR_REGISTRY_VERSION,
        generatorVersion: RESEARCH_ENGINE_VERSION,
        ...templateMetadata,
      });
      if (!structural) {
        exactDuplicates++;
        await researchRepository.update(run.id, {
          exactDuplicateCount: exactDuplicates,
          duplicateCount: exactDuplicates + semanticDuplicates,
          generatedRawCount: rawGenerated,
        });
        await recordAttempt("EXACT_DUPLICATE", {
          rejectionCode: "EXACT_DUPLICATE",
          rejectionMessage:
            "Candidate insert conflicted with an existing normalized AST",
          selectedIndicators: generated.indicators,
          selectedTemplateIds: generated.rawAst.templateIds,
        });
        continue;
      }
      await recordAttempt("ACCEPTED_FOR_EVALUATION", {
        candidateId: structural.id,
        selectedIndicators: generated.indicators,
        selectedTemplateIds: generated.rawAst.templateIds,
      });
      seen.add(normalized.hash);
      semanticSeen.add(preflight.semanticFingerprint);
      acceptedCount++;
      acceptedValidUnique++;
      await researchRepository.update(run.id, {
        queuedForIsCount: acceptedCount,
        acceptedValidUniqueCount: acceptedValidUnique,
        templateCounts,
        predicateRoleCounts,
        sharedFilterCount,
        multiConditionCount,
        crossFamilyCount,
      });
      await researchRepository.heartbeat(run.id, claimToken, {
        stage: "IS_EVALUATION",
        progress: 0.45,
      });
      const isSimulation = await simulate(
        generated.config,
        engine,
        input.initialBalance,
        undefined,
        () =>
          this.staleClaim ||
          researchRepository.get(run.id)?.status === "CANCELLING",
        {},
        periods.is,
      );
      if (
        isSimulation.cancelled ||
        researchRepository.get(run.id)?.status === "CANCELLING"
      ) {
        await researchRepository.update(run.id, {
          status: "CANCELLED",
          health: "DEGRADED",
          stage: "CANCELLED",
          terminalOutcome: "CANCELLED",
          completionReason: "CANCELLED_BY_USER",
          cancelledCount: 1,
          terminalPersisted: true,
          completionMessage: "Research Run cancelled by the user.",
          leaseExpiresAt: null,
          workerId: null,
          claimToken: null,
          claimedAt: null,
          completedAt: new Date(),
        });
        return;
      }
      const isMetrics = metricSummary(isSimulation);
      evaluatedInIs++;
      isTested++;
      const isFailures = qualityFailures(isMetrics, input, "is");
      if (isFailures.length) rejectedInIs++;
      const stageReasons: Record<string, unknown> = { is: isFailures };
      let status = "IS_REJECTED",
        rejectionStage: string | null = "IS",
        rejectionReason: string | null = isFailures.join(",") || null,
        oosMetrics: ReturnType<typeof metricSummary> | null = null,
        score: number | null = null;
      if (!isFailures.length) {
        isSurvivor++;
        await researchRepository.heartbeat(run.id, claimToken, {
          stage: "OOS_SCREENING",
          progress: 0.6,
        });
        const oosSimulation = await simulate(
          structurallySimplifiedConfig,
          engine,
          isMetrics.finalEquity,
          undefined,
          () =>
            this.staleClaim ||
            researchRepository.get(run.id)?.status === "CANCELLING",
          {},
          { ...periods.oos, startExclusive: true },
        );
        if (
          oosSimulation.cancelled ||
          researchRepository.get(run.id)?.status === "CANCELLING"
        ) {
          await researchRepository.update(run.id, {
            status: "CANCELLED",
            health: "DEGRADED",
            stage: "CANCELLED",
            terminalOutcome: "CANCELLED",
            completionReason: "CANCELLED_BY_USER",
            cancelledCount: 1,
            terminalPersisted: true,
            completionMessage: "Research Run cancelled by the user.",
            leaseExpiresAt: null,
            workerId: null,
            claimToken: null,
            claimedAt: null,
            completedAt: new Date(),
          });
          return;
        }
        oosMetrics = metricSummary(oosSimulation);
        oosTested++;
        const oosFailures = qualityFailures(oosMetrics, input, "oos");
        stageReasons.oos = oosFailures;
        if (!oosFailures.length) {
          oosSurvivor++;
          advancedToOos++;
          score =
            Number(oosMetrics.profitFactor ?? 0) * 100 +
            Number(oosMetrics.return ?? 0) -
            Math.abs(Number(oosMetrics.maxDrawdownPct ?? 0)) -
            complexity * 2;
          status = "FINALIST";
          rejectionStage = null;
          rejectionReason = null;
          finalists.push({
            id: structural.id,
            config: structurallySimplifiedConfig,
            score,
          });
        } else {
          rejectedInOos++;
          status = "OOS_REJECTED";
          rejectionStage = "OOS";
          rejectionReason = oosFailures.join(",");
        }
      }
      await researchRepository.updateCandidate(structural.id, {
        status,
        metrics: { is: isMetrics, oos: oosMetrics },
        score,
        rejectionStage,
        rejectionReason,
        stageRejectionReasons: stageReasons,
        terminalReason: status === "FINALIST" ? null : rejectionReason,
      });
      await researchRepository.update(run.id, {
        stage: "OOS_SCREENING",
        progress: 0.45 + (acceptedCount / input.candidateBudget) * 0.3,
        generatedCount: acceptedCount,
        generatedRawCount: rawGenerated,
        acceptedCandidateCount: acceptedCount,
        isTestedCount: isTested,
        isSurvivorCount: isSurvivor,
        oosTestedCount: oosTested,
        oosSurvivorCount: oosSurvivor,
        duplicateCount: exactDuplicates + semanticDuplicates,
        exactDuplicateCount: exactDuplicates,
        semanticDuplicateCount: semanticDuplicates,
        evaluatedInIs,
        rejectedInIsCount: rejectedInIs,
        advancedToOosCount: advancedToOos,
        rejectedInOosCount: rejectedInOos,
        acceptedValidUniqueCount: acceptedValidUnique,
        templateCounts,
        predicateRoleCounts,
        sharedFilterCount,
        multiConditionCount,
        crossFamilyCount,
      });
    }
    const generationExhausted = acceptedCount < input.candidateBudget,
      generationReason = generationExhausted
        ? `Generated ${acceptedCount} valid unique candidates after ${attempt} attempts; requested ${input.candidateBudget}.`
        : null;
    const selected = finalists
      .sort((left, right) => right.score - left.score)
      .slice(0, input.maximumHoldoutCandidates);
    const selectedIds = new Set(selected.map((item) => item.id));
    for (const finalist of finalists.filter(
      (item) => !selectedIds.has(item.id),
    ))
      await researchRepository.updateCandidate(finalist.id, {
        status: "REJECTED",
        rejectionStage: "HOLDOUT",
        rejectionReason: "MAXIMUM_HOLDOUT_CANDIDATES",
        terminalReason: "NOT_SELECTED_FOR_HOLDOUT",
      });
    await researchRepository.update(run.id, {
      stage: "HOLDOUT_EVALUATION",
      progress: 0.8,
      finalistCount: selected.length,
    });
    for (const finalist of selected) {
      const candidate = researchRepository.candidate(finalist.id);
      if (!candidate) continue;
      if (researchRepository.get(run.id)?.status === "CANCELLING") {
        await researchRepository.update(run.id, {
          status: "CANCELLED",
          health: "DEGRADED",
          stage: "CANCELLED",
          terminalOutcome: "CANCELLED",
          completionReason: "CANCELLED_BY_USER",
          cancelledCount: 1,
          terminalPersisted: true,
          completionMessage: "Research Run cancelled by the user.",
          leaseExpiresAt: null,
          workerId: null,
          claimToken: null,
          claimedAt: null,
          completedAt: new Date(),
        });
        return;
      }
      await researchRepository.heartbeat(run.id, claimToken, {
        stage: "HOLDOUT_EVALUATION",
        progress: 0.8,
      });
      const oos = candidate.metrics?.oos as
          | { finalEquity?: unknown; equity?: Array<{ balance?: unknown }> }
          | undefined,
        oosFinalEquity = Number(
          oos?.finalEquity ??
            oos?.equity?.at(-1)?.balance ??
            input.initialBalance,
        ),
        holdoutSimulation = await simulate(
          finalist.config,
          engine,
          Number.isFinite(oosFinalEquity)
            ? oosFinalEquity
            : input.initialBalance,
          undefined,
          () =>
            this.staleClaim ||
            researchRepository.get(run.id)?.status === "CANCELLING",
          {},
          { ...periods.holdout, startExclusive: true },
        );
      if (
        holdoutSimulation.cancelled ||
        researchRepository.get(run.id)?.status === "CANCELLING"
      ) {
        await researchRepository.update(run.id, {
          status: "CANCELLED",
          health: "DEGRADED",
          stage: "CANCELLED",
          terminalOutcome: "CANCELLED",
          completionReason: "CANCELLED_BY_USER",
          cancelledCount: 1,
          terminalPersisted: true,
          completionMessage: "Research Run cancelled by the user.",
          leaseExpiresAt: null,
          workerId: null,
          claimToken: null,
          claimedAt: null,
          completedAt: new Date(),
        });
        return;
      }
      const holdout = metricSummary(holdoutSimulation),
        failures = qualityFailures(holdout, input, "holdout"),
        status = failures.length ? "HOLDOUT_REJECTED" : "COMPLETED";
      if (failures.length) rejectedInHoldout++;
      else advancedToHoldout++;
      await researchRepository.updateCandidate(finalist.id, {
        status,
        metrics: { ...candidate.metrics, holdout },
        score: finalist.score,
        rejectionStage: failures.length ? "HOLDOUT" : null,
        rejectionReason: failures.length ? failures.join(",") : null,
        stageRejectionReasons: {
          ...(candidate.stageRejectionReasons ?? {}),
          holdout: failures,
        },
        terminalReason: failures.length
          ? failures.join(",")
          : "HOLDOUT_CONFIRMED",
      });
    }
    const reconciliation = await researchRepository.reconcile(run.id);
    if (reconciliation.transient)
      for (const candidate of researchRepository
        .candidates(run.id, 10_000, 0)
        .filter((item) => !terminalCandidateStatuses.has(item.status)))
        await researchRepository.updateCandidate(candidate.id, {
          status: "EVALUATION_FAILED",
          rejectionStage: "FINALIZATION",
          rejectionReason: "UNRECONCILED_TRANSIENT_STATE",
          terminalReason: "FINALIZATION_RECONCILIATION",
        });
    await researchRepository.reconcile(run.id);
    const generationReconciliation =
      await researchRepository.reconcileGeneration(run.id);
    if (generationReconciliation.status === "MISMATCH") {
      await researchRepository.update(run.id, {
        status: "FAILED",
        health: "UNHEALTHY",
        stage: "FAILED",
        terminalOutcome: "FAILED",
        errorCode: "GENERATION_ACCOUNTING_MISMATCH",
        errorMessage: `Generation accounting mismatch of ${generationReconciliation.mismatch}`,
        completionReason: "GENERATION_ACCOUNTING_MISMATCH",
        completionMessage:
          "Research Run failed because generation attempts did not reconcile.",
        workerFailureCode: "GENERATION_ACCOUNTING_MISMATCH",
        workerFailureMessage: JSON.stringify(generationReconciliation),
        terminalPersisted: true,
        completedAt: new Date(),
        leaseExpiresAt: null,
      });
      return;
    }
    const terminalOutcome = resolveResearchTerminalOutcome(
        acceptedCount,
        input.candidateBudget,
        generationExhausted,
      ),
      completionMessage =
        terminalOutcome === "COMPLETED"
          ? `Research Run completed after evaluating ${acceptedCount} candidates.`
          : terminalOutcome === "PARTIAL"
            ? `Research Run reached the generation limit with ${acceptedCount} of ${input.candidateBudget} requested candidates.`
            : `Research Run exhausted ${attempt} generation attempts without producing a valid candidate.`;
    await researchRepository.update(run.id, {
      status: "COMPLETED",
      health: terminalOutcome === "COMPLETED" ? "HEALTHY" : "DEGRADED",
      stage: "FINALIZING",
      progress: 1,
      terminalOutcome,
      completionMessage,
      holdoutEvaluated: true,
      holdoutTestedCount: selected.length,
      generationExhausted,
      generationExhaustionReason: generationReason,
      completionReason: generationReason ?? "REQUESTED_BUDGET_EVALUATED",
      terminalPersisted: true,
      evaluatedInIsCount: evaluatedInIs,
      rejectedInIsCount: rejectedInIs,
      advancedToOosCount: advancedToOos,
      rejectedInOosCount: rejectedInOos,
      advancedToHoldoutCount: advancedToHoldout,
      rejectedInHoldoutCount: rejectedInHoldout,
      acceptedValidUniqueCount: acceptedValidUnique,
      templateCounts,
      predicateRoleCounts,
      sharedFilterCount,
      multiConditionCount,
      crossFamilyCount,
      leaseExpiresAt: null,
      workerId: null,
      claimToken: null,
      claimedAt: null,
      completedAt: new Date(),
    });
    await researchRepository.log(
      run.id,
      terminalOutcome === "COMPLETED" ? "INFO" : "WARN",
      "FINALIZING",
      terminalOutcome === "COMPLETED"
        ? "RUN_COMPLETED"
        : terminalOutcome === "PARTIAL"
          ? "RUN_PARTIAL_COMPLETED"
          : "RUN_EXHAUSTED",
      completionMessage,
      {
        finalists: selected.length,
        acceptedCandidates: acceptedCount,
        requestedCandidates: input.candidateBudget,
        attempts: attempt,
        rawGenerated,
        generationErrors,
      },
    );
  }
}
export const researchWorker = new ResearchWorker();
export function researchConfigHash(input: ResearchRunInput) {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
export function researchDatasetFingerprint(input: ResearchRunInput) {
  const warmupBars = requiredResearchWarmup(input);
  return dataFingerprint(
    input.symbol,
    [...new Set([input.triggerTimeframe, input.executionTimeframe])],
    input.period.start,
    input.period.end,
    warmupBars,
  );
}
export function requiredResearchWarmup(input: ResearchRunInput) {
  const frames = [
      ...new Set([input.triggerTimeframe, input.executionTimeframe]),
    ],
    warmup = Object.fromEntries(frames.map((frame) => [frame, 0])) as Record<
      string,
      number
    >;
  for (const indicator of input.allowedIndicators) {
    const definition = indicatorRegistry[indicator];
    if (!definition) continue;
    const parameters = Object.fromEntries(
      Object.entries(definition.parameters).map(([name, value]) => [
        name,
        value.default,
      ]),
    );
    try {
      warmup[input.triggerTimeframe] = Math.max(
        warmup[input.triggerTimeframe] ?? 0,
        validateIndicator(indicator, parameters).warmupBars(parameters),
      );
    } catch {}
  }
  // Execution candles need enough context to evaluate fills and any trigger carried into them.
  warmup[input.executionTimeframe] = Math.max(
    warmup[input.executionTimeframe] ?? 0,
    1,
  );
  return warmup;
}
