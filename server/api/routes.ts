import type { FastifyInstance } from "fastify";
import { once } from "node:events";
import { z } from "zod";
import { config, runtimeSettings, safeConfig } from "../config.js";
import {
  candleRepository,
  eventRepository,
  gapRepository,
  jobRepository,
  metadataRepository,
  systemStateRepository,
} from "../db/repository.js";
import {
  backup,
  checkpoint,
  databaseOverview,
  optimize,
} from "../db/maintenance.js";
import { eventBus } from "../events/bus.js";
import { liveState } from "../live-state.js";
import { metrics } from "../observability.js";
import { backfillWorker } from "../workers/backfill.js";
import { gapRepairWorker } from "../workers/gap-repair.js";
import { aggregationEngine } from "../workers/aggregation.js";
import { gapService } from "../services/gap-service.js";
import { refreshMetadata } from "../services/metadata-service.js";
import { liveIngestionWorker } from "../workers/live-ingestion.js";
import { calculateIndicator, INDICATOR_REGISTRY_VERSION, indicatorRegistry } from "../strategy/indicators.js";
import { intervalMs } from "../domain/intervals.js";
import { verificationReportPdf } from "../strategy/pdf-report.js";
import { researchCandidateReportPdf, researchRunCandidatesReportPdf } from "../strategy/research-candidate-report.js";
import { tradeCsvHeader, tradeCsvLine, VERIFICATION_EXPORT_VERSION } from "../strategy/export.js";
import { auditVerificationRun, persistedTradeToSimTrade, reconstructedBalanceCurve } from "../strategy/verification-audit.js";
import { configurationHash, createRunSchema, createStrategySchema, researchRunSchema, StrategyLifecycle, strategyConfigSchema, strategyWarmupBars, validateStrategyConfiguration } from "../strategy/model.js";
import { strategyRepository, verificationRepository } from "../strategy/repository.js";
import { researchRepository } from "../strategy/research-repository.js";
import { RESEARCH_ENGINE_VERSION, RESEARCH_SPLITTER_VERSION, researchConfigHash, researchDatasetFingerprint, splitResearchPeriod } from "../strategy/research-worker.js";
import { compareVerificationRuns } from "../strategy/comparability.js";
import { dataFingerprint, historicalAvailability, REPORT_ENGINE_VERSION, ROBUSTNESS_ENGINE_VERSION, SIMULATION_ENGINE_VERSION, STRESS_ENGINE_VERSION, WALK_FORWARD_ENGINE_VERSION } from "../strategy/verification-worker.js";
import { MONTE_CARLO_ENGINE_VERSION } from "../strategy/monte-carlo.js";
import { METRICS_ENGINE_VERSION, scorecard, verificationMetrics } from "../strategy/metrics.js";

const date = z.coerce.date();
const symbol = z
  .string()
  .regex(/^[A-Z0-9_]+$/)
  .transform((s) => s.toUpperCase());
/** Field-level diff for immutable strategy snapshots; list order is semantic. */
export function configurationDiff(left: unknown, right: unknown, path = "configuration"): Array<{ path: string; left: unknown; right: unknown }> {
  if (Object.is(left, right)) return [];
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) => configurationDiff(left[index], right[index], `${path}[${index}]`)).flat();
  }
  if (Array.isArray(left) || Array.isArray(right) || !left || !right || typeof left !== "object" || typeof right !== "object") return [{ path, left, right }];
  const keys = new Set([...Object.keys(left as Record<string, unknown>), ...Object.keys(right as Record<string, unknown>)]);
  return [...keys].flatMap((key) => configurationDiff((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`));
}
function availabilityWithWarmup(symbol: string, configuration: z.infer<typeof strategyConfigSchema>, start: Date, end: Date) {
  const warmups = strategyWarmupBars(configuration);
  return historicalAvailability(symbol, configuration.requiredTimeframes, start, end).map((availability) => {
    const warmupBars = warmups[availability.timeframe] ?? 0;
    const warmupStart = new Date(start.getTime() - intervalMs(availability.timeframe) * warmupBars);
    const warmupAvailable = warmupBars ? candleRepository.verificationRange(symbol, availability.timeframe, warmupStart, new Date(start.getTime() - 1)).length : 0;
    return { ...availability, warmupBars, warmupAvailable, warmupComplete: warmupAvailable >= warmupBars, warmupContextStart: warmupBars ? warmupStart : start, earliestUsableDate: warmupBars ? new Date(warmupStart.getTime() + intervalMs(availability.timeframe) * warmupBars) : start, pointInTimeStatus: "CLOSED_CANDLES_ONLY" };
  });
}
function indicatorIdsIn(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = record.type === "indicator" && typeof record.indicator === "string" ? [record.indicator] : [];
  return [...direct, ...Object.values(record).flatMap(indicatorIdsIn)];
}
async function markVerificationComponent(id: string, field: "exportVersion" | "reportEngineVersion", version: string) {
  return (await verificationRepository.update(id, { [field]: version })) ?? verificationRepository.get(id);
}
export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/status", async () => ({
    ...liveState.snapshot(),
    database: databaseOverview(),
    config: safeConfig(),
    jobs: jobRepository.list().slice(0, 20),
    gaps: gapRepository.list(true),
  }));
  app.get("/api/streams", async () => liveState.snapshot().symbols);
  app.get("/api/candles/recent/:symbol", async (request) => {
    const p = z.object({ symbol }).parse(request.params);
    const q = z
      .object({
        timeframe: z.string().default("1m"),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        before: date.optional(),
      })
      .parse(request.query);
    return candleRepository.recent(p.symbol, q.timeframe, q.limit, q.before);
  });
  app.get("/api/candles", async (request) => {
    const q = z
      .object({
        symbol,
        timeframe: z.string(),
        start: date,
        end: date,
        limit: z.coerce.number().int().min(1).max(5000).default(1000),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    return {
      rows: candleRepository.range(
        q.symbol,
        q.timeframe,
        q.start,
        q.end,
        q.limit,
        q.offset,
      ),
      total: candleRepository.count(q.symbol, q.timeframe, q.start, q.end),
      limit: q.limit,
      offset: q.offset,
    };
  });
  app.get("/api/candles.csv", async (request, reply) => {
    const q = z.object({ symbol, timeframe: z.string(), start: date, end: date }).parse(request.query);
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
    const fileName = `candles-${q.symbol}-${q.timeframe}-${q.start.toISOString().slice(0, 10)}-${q.end.toISOString().slice(0, 10)}.csv`;
    const header = ["open_time", "close_time", "exchange", "market", "symbol", "timeframe", "open", "high", "low", "close", "volume", "quote_volume", "trade_count", "taker_buy_base_volume", "taker_buy_quote_volume", "first_trade_id", "last_trade_id", "is_closed", "is_complete", "source", "event_time", "received_at", "persisted_at"].join(",");
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${fileName}`, "Cache-Control": "no-store" });
    const write = async (chunk: string) => { if (!reply.raw.write(chunk)) await once(reply.raw, "drain"); };
    await write(`${header}\n`);
    for (const candle of candleRepository.iterateRange(q.symbol, q.timeframe, q.start, q.end)) {
      await write([candle.openTime.toISOString(), candle.closeTime.toISOString(), candle.exchange, candle.market, candle.symbol, candle.timeframe, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.quoteVolume, candle.tradeCount, candle.takerBuyBaseVolume, candle.takerBuyQuoteVolume, candle.firstTradeId, candle.lastTradeId, candle.isClosed, candle.isComplete, candle.source, candle.eventTime?.toISOString(), candle.receivedAt.toISOString(), candle.persistedAt.toISOString()].map(escape).join(",") + "\n");
    }
    reply.raw.end();
  });
  app.get("/api/coverage", async () => candleRepository.coverage());
  app.get("/api/indicators", async () => Object.values(indicatorRegistry));
  app.get("/api/research-runs", async () => researchRepository.list());
  app.post("/api/research-runs", async (request, reply) => {
    const body = researchRunSchema.parse(request.body); if (body.executionTimeframe !== body.triggerTimeframe && !["1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(body.executionTimeframe)) return reply.code(400).send({ error: "Unsupported execution timeframe" });
    let periods; try { periods = splitResearchPeriod(body); } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid research periods" }); }
    const run = await researchRepository.create({ name: body.name, description: body.description, symbol: body.symbol, directions: body.directions, triggerTimeframe: body.triggerTimeframe, executionTimeframe: body.executionTimeframe, candidateBudget: body.candidateBudget, config: body, periods, configHash: researchConfigHash(body), datasetFingerprint: researchDatasetFingerprint(body), engineVersion: SIMULATION_ENGINE_VERSION, indicatorRegistryVersion: INDICATOR_REGISTRY_VERSION, searchAlgorithmVersion: RESEARCH_ENGINE_VERSION, splitterVersion: RESEARCH_SPLITTER_VERSION, randomSeed: body.randomSeed });
    await researchRepository.log(run.id, "INFO", "DRAFT", "RUN_CREATED", "Research Run draft created", { periods }); return reply.code(201).send(run);
  });
  app.post("/api/research-runs/preview-split", async (request, reply) => { const body = researchRunSchema.parse(request.body); try { return { periods: splitResearchPeriod(body), splitterVersion: RESEARCH_SPLITTER_VERSION, policy: body.period.policy, warnings: [] }; } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid research periods" }); } });
  app.get("/api/research-runs/:id", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); return { ...run, candidateCount: researchRepository.candidateCount(id), events: researchRepository.events(id) }; });
  app.post("/api/research-runs/:id/launch", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); if (!["DRAFT", "FAILED", "CANCELLED", "PAUSED"].includes(run.status)) return reply.code(409).send({ error: "Only draft, paused, failed or cancelled Research Runs can be launched" }); const launched = await researchRepository.launch(id); await researchRepository.log(id, "INFO", "QUEUED", "RUN_QUEUED", "Research Run queued"); return reply.code(202).send(launched); });
  app.post("/api/research-runs/:id/pause", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); if (run.status !== "RUNNING") return reply.code(409).send({ error: "Only a running Research Run can be paused" }); return researchRepository.requestPause(id); });
  app.post("/api/research-runs/:id/resume", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); if (run.status !== "PAUSED") return reply.code(409).send({ error: "Only a paused Research Run can be resumed" }); return researchRepository.update(id, { status: "RESUMING", stage: "RESUMING" }); });
  app.post("/api/research-runs/:id/cancel", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); if (!["QUEUED", "RUNNING", "PAUSING", "PAUSED", "RESUMING"].includes(run.status)) return reply.code(409).send({ error: "Research Run cannot be cancelled in its current state" }); return researchRepository.requestCancel(id); });
  app.delete("/api/research-runs/:id", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); if (!["DRAFT", "COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return reply.code(409).send({ error: "Cancel an active Research Run before deleting it" }); if (!await researchRepository.delete(id)) return reply.code(409).send({ error: "Research Runs with promoted Candidates are retained to preserve Strategy provenance" }); return { deleted: true }; });
  app.get("/api/research-runs/:id/candidates", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (!researchRepository.get(id)) return reply.code(404).send({ error: "Research Run not found" }); const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query); await researchRepository.exposeHoldout(id); return { rows: researchRepository.candidates(id, query.limit, query.offset), total: researchRepository.candidateCount(id), limit: query.limit, offset: query.offset }; });
  app.get("/api/research-runs/:id/candidates/report.pdf", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = researchRepository.get(id); if (!run) return reply.code(404).send({ error: "Research Run not found" }); const pdf = await researchRunCandidatesReportPdf({ run, candidates: researchRepository.candidates(id, 5000, 0) }); return reply.header("Content-Disposition", `attachment; filename=treidin-candidates-${id}.pdf`).type("application/pdf").send(pdf); });
  app.get("/api/research-candidates/:id", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); return researchRepository.candidate(id) ?? reply.code(404).send({ error: "Research Candidate not found" }); });
  app.get("/api/research-candidates/:id/report.pdf", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const candidate = researchRepository.candidate(id); if (!candidate) return reply.code(404).send({ error: "Research Candidate not found" }); const run = researchRepository.get(candidate.researchRunId); if (!run) return reply.code(409).send({ error: "Source Research Run is missing" }); const pdf = await researchCandidateReportPdf({ run, candidate }); return reply.header("Content-Disposition", `attachment; filename=treidin-candidate-${id}.pdf`).type("application/pdf").send(pdf); });
  app.post("/api/research-candidates/:id/promote", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const candidate = researchRepository.candidate(id); if (!candidate) return reply.code(404).send({ error: "Research Candidate not found" }); if (candidate.promotedStrategyId) return reply.code(409).send({ error: "Candidate has already been promoted", strategyId: candidate.promotedStrategyId }); if (candidate.status !== "COMPLETED") return reply.code(409).send({ error: "Only holdout-confirmed Candidates can be promoted" });
    const body = z.object({ name: z.string().min(2).max(120), description: z.string().max(4000).default(""), tags: z.array(z.string().min(1).max(40)).max(20).default([]), note: z.string().max(2000).default(""), verify: z.boolean().default(false) }).parse(request.body); const run = researchRepository.get(candidate.researchRunId); if (!run) return reply.code(409).send({ error: "Source Research Run is missing" }); const config = strategyConfigSchema.parse(candidate.configuration); const sourcePeriod = run.config as { period: { start: string | Date; end: string | Date }; initialBalance: number }; const verificationRange = { start: new Date(sourcePeriod.period.start), end: new Date(sourcePeriod.period.end) }; const verificationAvailability = body.verify ? availabilityWithWarmup(run.symbol, config, verificationRange.start, verificationRange.end) : []; const unavailable = verificationAvailability.filter((item) => !item.candles || item.gaps || item.completeness < 99.5 || !item.warmupComplete); if (body.verify && unavailable.length) return reply.code(409).send({ error: "Full Verification is blocked by incomplete historical data; Candidate was not promoted", unavailable });
    const strategy = await strategyRepository.create({ name: body.name, description: body.description, tags: body.tags, origin: "STRATEGY_LAB", lifecycle: "READY_FOR_DEEP_VERIFICATION", sourceResearchRunId: run.id, sourceCandidateId: candidate.id, sourceNormalizedHash: candidate.normalizedHash }); const version = await strategyRepository.publish(strategy.id, config, configurationHash(config), INDICATOR_REGISTRY_VERSION, body.note || `Promoted from Research Run ${run.id.slice(0, 8)}`);
    let verificationRunId: string | null = null;
    if (body.verify) { const created = await verificationRepository.create({ strategyVersionId: version.id, name: `${strategy.name} / Full Verification`, symbol: run.symbol, market: config.market, requestedStart: verificationRange.start, requestedEnd: verificationRange.end, actualStart: null, actualEnd: null, estimatedWork: verificationAvailability.find((item) => item.timeframe === config.triggerTimeframe)?.candles ?? 0, profile: "FULL", options: { initialBalance: sourcePeriod.initialBalance, monteCarloCount: 500, oosSplit: .7 }, dataFingerprint: dataFingerprint(run.symbol, config.requiredTimeframes, verificationRange.start, verificationRange.end, strategyWarmupBars(config)), configurationHash: version.configurationHash, engineVersion: SIMULATION_ENGINE_VERSION, metricsVersion: METRICS_ENGINE_VERSION, monteCarloEngineVersion: MONTE_CARLO_ENGINE_VERSION, walkForwardEngineVersion: WALK_FORWARD_ENGINE_VERSION, robustnessEngineVersion: ROBUSTNESS_ENGINE_VERSION, stressEngineVersion: STRESS_ENGINE_VERSION, exportVersion: VERIFICATION_EXPORT_VERSION, reportEngineVersion: REPORT_ENGINE_VERSION, randomSeed: run.randomSeed }); verificationRunId = created.id; }
    await researchRepository.recordPromotion({ candidateId: candidate.id, runId: run.id, strategyId: strategy.id, strategyVersionId: version.id, verificationRunId, note: body.note }); await researchRepository.log(run.id, "INFO", "PROMOTION", "CANDIDATE_PROMOTED", `Candidate ${candidate.id.slice(0, 8)} promoted to Strategy ${strategy.id.slice(0, 8)}`, { strategyId: strategy.id, strategyVersionId: version.id, verificationRunId }); return reply.code(201).send({ strategy, version, verificationRunId });
  });
  app.get("/api/strategies", async (request) => {
    const query = z.object({ search: z.string().trim().max(120).optional(), lifecycle: StrategyLifecycle.optional(), origin: z.enum(["MANUAL", "STRATEGY_LAB"]).optional() }).parse(request.query);
    const search = query.search?.toLocaleLowerCase();
    return strategyRepository.list().map((item) => {
      const versions = strategyRepository.versions(item.id);
      const versionIds = new Set(versions.map((version) => version.id));
      const runs = verificationRepository.list().filter((run) => versionIds.has(run.strategyVersionId));
      const latestVersion = versions[0] ?? null;
      const latestVerification = runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
      return { ...item, versions, versionCount: versions.length, latestVersion, verificationRunsCount: runs.length, latestVerification, warnings: [!versions.length ? "NO_IMMUTABLE_VERSION" : null, !runs.length ? "NO_VERIFICATION" : null, latestVerification?.status === "FAILED" ? "LATEST_VERIFICATION_FAILED" : null, item.lifecycle === "RETIRED" ? "RETIRED" : null].filter(Boolean) };
    }).filter((item) => (!query.lifecycle || item.lifecycle === query.lifecycle) && (!query.origin || item.origin === query.origin) && (!search || [item.name, item.description, ...item.tags].join(" ").toLocaleLowerCase().includes(search)));
  });
  app.post("/api/strategies", async (request, reply) => {
    const body = createStrategySchema.parse(request.body);
    const errors = validateStrategyConfiguration(body.configuration); if (errors.length) return reply.code(400).send({ error: "Strategy configuration is invalid", errors });
    const strategy = await strategyRepository.create(body);
    const version = await strategyRepository.publish(strategy.id, body.configuration, configurationHash(body.configuration), INDICATOR_REGISTRY_VERSION, body.changeNotes);
    return reply.code(201).send({ strategy, version });
  });
  app.get("/api/strategies/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const strategy = strategyRepository.get(id); if (!strategy) return reply.code(404).send({ error: "Strategy not found" }); const versions = strategyRepository.versions(id); const ids = new Set(versions.map((version) => version.id)); const verificationRuns = verificationRepository.list().filter((run) => ids.has(run.strategyVersionId)); return { ...strategy, versions, verificationRuns, research: null, timeline: strategyRepository.events(id) };
  });
  app.post("/api/strategies/:id/lifecycle", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (!strategyRepository.get(id)) return reply.code(404).send({ error: "Strategy not found" }); const body = z.object({ lifecycle: StrategyLifecycle }).parse(request.body); return strategyRepository.setLifecycle(id, body.lifecycle);
  });
  app.post("/api/strategies/:id/retire", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (!strategyRepository.get(id)) return reply.code(404).send({ error: "Strategy not found" }); return strategyRepository.archive(id);
  });
  app.post("/api/strategies/:id/versions", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (!strategyRepository.get(id)) return reply.code(404).send({ error: "Strategy not found" }); const body = z.object({ configuration: strategyConfigSchema, changeNotes: z.string().max(2000).default(""), parentVersionId: z.string().uuid().optional() }).parse(request.body); const errors = validateStrategyConfiguration(body.configuration); if (errors.length) return reply.code(400).send({ error: "Strategy configuration is invalid", errors }); return reply.code(201).send(await strategyRepository.publish(id, body.configuration, configurationHash(body.configuration), INDICATOR_REGISTRY_VERSION, body.changeNotes, body.parentVersionId));
  });
  app.get("/api/strategies/:id/availability", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const version = strategyRepository.versions(id)[0]; if (!version) return []; const query = z.object({ symbol, start: date, end: date }).parse(request.query); return availabilityWithWarmup(query.symbol, version.configuration, query.start, query.end);
  });
  app.get("/api/strategy-versions/:id", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const version = strategyRepository.version(id); return version ?? reply.code(404).send({ error: "Strategy version not found" }); });
  app.get("/api/strategy-versions/:id/configuration.json", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const version = strategyRepository.version(id); if (!version) return reply.code(404).send({ error: "Strategy version not found" }); return reply.header("Content-Disposition", `attachment; filename=strategy-version-${id}.json`).type("application/json; charset=utf-8").send({ strategyVersionId: version.id, strategyId: version.strategyId, versionNumber: version.versionNumber, parentVersionId: version.parentVersionId, createdAt: version.createdAt, configurationHash: version.configurationHash, indicatorRegistryVersion: version.indicatorRegistryVersion, verificationStatus: version.verificationStatus, changeNotes: version.changeNotes, configuration: version.configuration }); });
  app.post("/api/strategy-versions/:id/clone", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const source = strategyRepository.version(id); if (!source) return reply.code(404).send({ error: "Strategy version not found" }); const sourceStrategy = strategyRepository.get(source.strategyId); if (!sourceStrategy) return reply.code(404).send({ error: "Source strategy not found" }); const body = z.object({ name: z.string().min(2).max(120).optional(), changeNotes: z.string().max(2000).default("Cloned immutable strategy version") }).parse(request.body ?? {}); const strategy = await strategyRepository.create({ name: body.name ?? `${sourceStrategy.name} (clone v${source.versionNumber})`, description: sourceStrategy.description, tags: [...sourceStrategy.tags, "clone"], origin: sourceStrategy.origin, clonedFromStrategyId: sourceStrategy.id, sourceResearchRunId: sourceStrategy.sourceResearchRunId, sourceCandidateId: sourceStrategy.sourceCandidateId, sourceNormalizedHash: sourceStrategy.sourceNormalizedHash }); const version = await strategyRepository.publish(strategy.id, source.configuration, source.configurationHash, source.indicatorRegistryVersion, body.changeNotes, source.id); return reply.code(201).send({ strategy, version, clonedFromVersionId: source.id }); });
  app.get("/api/strategy-versions/:id/availability", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const version = strategyRepository.version(id); if (!version) return reply.code(404).send({ error: "Strategy version not found" }); const query = z.object({ symbol, start: date, end: date }).parse(request.query); return availabilityWithWarmup(query.symbol, version.configuration, query.start, query.end); });
  app.post("/api/strategy-versions/:id/dry-validation", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params), version = strategyRepository.version(id);
    if (!version) return reply.code(404).send({ error: "Strategy version not found" });
    const body = z.object({ symbol, start: date, end: date }).parse(request.body);
    if (body.end <= body.start) return reply.code(400).send({ error: "The end must be later than the start" });
    const config = version.configuration, validationErrors = validateStrategyConfiguration(config), availability = availabilityWithWarmup(body.symbol, config, body.start, body.end), unavailable = availability.filter((item) => !item.candles || item.gaps || item.completeness < 99.5 || !item.warmupComplete), indicatorsUsed = [...new Set([config.longEntry, config.shortEntry, config.longExit, config.shortExit].flatMap(indicatorIdsIn))].sort();
    return { valid: validationErrors.length === 0 && unavailable.length === 0, validationErrors, availability, warnings: [...(config.costs.fundingMode === "NONE" ? ["Funding is not modeled."] : []), ...unavailable.map((item) => `${item.timeframe}: incomplete historical data or warm-up context`)], preview: { strategyVersionId: version.id, versionNumber: version.versionNumber, configurationHash: version.configurationHash, symbol: body.symbol, requestedStart: body.start, requestedEnd: body.end, triggerTimeframe: config.triggerTimeframe, executionTimeframe: config.executionTimeframe, requiredTimeframes: config.requiredTimeframes, indicatorsUsed, directions: config.directions, stop: config.stop, takeProfit: config.takeProfit, minimumRiskReward: config.minimumRiskReward, trailing: config.trailing, sizing: config.sizing, leverage: config.leverage, costs: config.costs, longEntry: config.longEntry, shortEntry: config.shortEntry, longExit: config.longExit, shortExit: config.shortExit } };
  });
  app.post("/api/strategy-versions/:id/archive", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (!strategyRepository.version(id)) return reply.code(404).send({ error: "Strategy version not found" }); return strategyRepository.archiveVersion(id); });
  app.get("/api/strategy-versions/compare", async (request, reply) => { const query = z.object({ left: z.string().uuid(), right: z.string().uuid() }).parse(request.query); const left = strategyRepository.version(query.left), right = strategyRepository.version(query.right); if (!left || !right) return reply.code(404).send({ error: "One or both strategy versions were not found" }); return { left: { id: left.id, versionNumber: left.versionNumber, configurationHash: left.configurationHash }, right: { id: right.id, versionNumber: right.versionNumber, configurationHash: right.configurationHash }, differences: configurationDiff(left.configuration, right.configuration) }; });
  app.post("/api/strategy-versions/:id/verification-runs", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const version = strategyRepository.version(id); if (!version) return reply.code(404).send({ error: "Strategy version not found" }); const body = createRunSchema.parse(request.body); if (body.end <= body.start) return reply.code(400).send({ error: "The end must be later than the start" }); const availability = availabilityWithWarmup(body.symbol, version.configuration, body.start, body.end); const warmupBars = strategyWarmupBars(version.configuration), unavailable = availability.filter((f) => !f.candles || f.gaps || f.completeness < 99.5 || !f.warmupComplete); if (unavailable.length) return reply.code(409).send({ error: "Historical data or warm-up context is incomplete for this version", availability, unavailable }); const run = await verificationRepository.create({ strategyVersionId: id, name: body.name, symbol: body.symbol, market: version.configuration.market, requestedStart: body.start, requestedEnd: body.end, actualStart: null, actualEnd: null, estimatedWork: availability.find((x) => x.timeframe === version.configuration.triggerTimeframe)?.candles ?? 0, profile: body.profile, options: { initialBalance: body.initialBalance, monteCarloCount: body.profile === "QUICK" ? 0 : body.monteCarloCount, oosSplit: body.oosSplit }, dataFingerprint: dataFingerprint(body.symbol, version.configuration.requiredTimeframes, body.start, body.end, warmupBars), configurationHash: version.configurationHash, engineVersion: SIMULATION_ENGINE_VERSION, metricsVersion: METRICS_ENGINE_VERSION, monteCarloEngineVersion: MONTE_CARLO_ENGINE_VERSION, walkForwardEngineVersion: WALK_FORWARD_ENGINE_VERSION, robustnessEngineVersion: ROBUSTNESS_ENGINE_VERSION, stressEngineVersion: STRESS_ENGINE_VERSION, exportVersion: VERIFICATION_EXPORT_VERSION, reportEngineVersion: REPORT_ENGINE_VERSION, randomSeed: body.randomSeed }); return reply.code(202).send(run);
  });
  app.get("/api/verification-runs", async () => verificationRepository.list().map((run) => { const version = strategyRepository.version(run.strategyVersionId), strategy = version ? strategyRepository.get(version.strategyId) : null; return { ...run, strategy: strategy ? { id: strategy.id, name: strategy.name, origin: strategy.origin, sourceResearchRunId: strategy.sourceResearchRunId, sourceCandidateId: strategy.sourceCandidateId, sourceNormalizedHash: strategy.sourceNormalizedHash } : null, strategyVersion: version ? { id: version.id, versionNumber: version.versionNumber } : null }; }));
  app.get("/api/verification-runs/:id/events", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); if (!verificationRepository.get(id)) return reply.code(404).send({ error: "Verification run not found" }); reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" }); let previous = ""; const publish = () => { const run = verificationRepository.get(id); if (!run) return; const snapshot = JSON.stringify({ id: run.id, status: run.status, stage: run.stage, progress: run.progress, stageProgress: run.stageProgress, candlesProcessed: run.candlesProcessed, eventsProcessed: run.eventsProcessed, tradesSimulated: run.tradesSimulated, estimatedWork: run.estimatedWork, startedAt: run.startedAt, completedAt: run.completedAt }); if (snapshot !== previous) { previous = snapshot; reply.raw.write(`event: verification-progress\ndata: ${snapshot}\n\n`); } if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) { clearInterval(timer); reply.raw.end(); } }; const timer = setInterval(publish, 500); publish(); request.raw.on("close", () => clearInterval(timer)); });
  app.get("/api/verification-runs/compare", async (request, reply) => { const query = z.object({ left: z.string().uuid(), right: z.string().uuid() }).parse(request.query); const left = verificationRepository.get(query.left), right = verificationRepository.get(query.right); if (!left || !right) return reply.code(404).send({ error: "One or both verification runs were not found" }); const leftResult = verificationRepository.result(left.id), rightResult = verificationRepository.result(right.id); if (!leftResult || !rightResult) return reply.code(409).send({ error: "Both verification runs must have completed results" }); const leftVersion = strategyRepository.version(left.strategyVersionId), rightVersion = strategyRepository.version(right.strategyVersionId); if (!leftVersion || !rightVersion) return reply.code(404).send({ error: "A strategy version for the comparison is missing" }); const leftMetrics = leftResult.metrics as Record<string, unknown>, rightMetrics = rightResult.metrics as Record<string, unknown>, metrics = [...new Set([...Object.keys(leftMetrics), ...Object.keys(rightMetrics)])].filter((key) => typeof leftMetrics[key] === "number" || typeof rightMetrics[key] === "number").map((key) => ({ key, left: leftMetrics[key] ?? null, right: rightMetrics[key] ?? null, delta: typeof leftMetrics[key] === "number" && typeof rightMetrics[key] === "number" ? Number(rightMetrics[key]) - Number(leftMetrics[key]) : null })); const leftTrades = verificationRepository.trades(left.id, 10_000, 0) as Array<Record<string, unknown>>, rightTrades = verificationRepository.trades(right.id, 10_000, 0) as Array<Record<string, unknown>>, identity = (trade: Record<string, unknown>) => `${trade.side}:${trade.entry_time}:${trade.exit_time}`, leftIds = new Set(leftTrades.map(identity)), rightIds = new Set(rightTrades.map(identity)), overlap = [...leftIds].filter((id) => rightIds.has(id)).length; const comparability = compareVerificationRuns(left, right, leftVersion.configuration, rightVersion.configuration); return { left: { run: left, metrics: leftMetrics, breakdowns: leftResult.breakdowns, equityCurve: leftResult.equityCurve }, right: { run: right, metrics: rightMetrics, breakdowns: rightResult.breakdowns, equityCurve: rightResult.equityCurve }, metrics, configurationDifferences: configurationDiff(leftVersion.configuration, rightVersion.configuration), comparability, tradeOverlap: { matchingTrades: overlap, leftOnly: leftIds.size - overlap, rightOnly: rightIds.size - overlap }, warnings: [left.configurationHash !== right.configurationHash ? "Configuration hashes differ; metrics are not from identical strategy snapshots." : null, left.symbol !== right.symbol ? "Symbols differ." : null, left.requestedStart.getTime() !== right.requestedStart.getTime() || left.requestedEnd.getTime() !== right.requestedEnd.getTime() ? "Requested periods differ." : null].filter(Boolean) }; });
  app.get("/api/verification-runs/:id/reproducibility", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" }); const version = strategyRepository.version(run.strategyVersionId); if (!version) return reply.code(404).send({ error: "Strategy version not found" }); const current = dataFingerprint(run.symbol, version.configuration.requiredTimeframes, run.requestedStart, run.requestedEnd, strategyWarmupBars(version.configuration)), original = run.dataFingerprint as Record<string, unknown>, dataChanged = JSON.stringify(original.frames ?? null) !== JSON.stringify(current.frames), warmupChanged = original.warmup ? JSON.stringify(original.warmup) !== JSON.stringify(current.warmup) : false; return { runId: run.id, configurationHash: run.configurationHash, engineVersion: run.engineVersion, metricsVersion: run.metricsVersion, originalFingerprint: original, currentFingerprint: current, dataChanged, warmupChanged, rerunRecommended: dataChanged || warmupChanged }; });
  app.post("/api/verification-runs/:id/clone", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const previous = verificationRepository.get(id); if (!previous) return reply.code(404).send({ error: "Verification run not found" }); const version = strategyRepository.version(previous.strategyVersionId); if (!version) return reply.code(404).send({ error: "Strategy version not found" }); const availability = availabilityWithWarmup(previous.symbol, version.configuration, previous.requestedStart, previous.requestedEnd); if (availability.some((item) => !item.warmupComplete || item.gaps || item.completeness < 99.5)) return reply.code(409).send({ error: "Current historical data is incomplete for this rerun", availability }); const clone = await verificationRepository.create({ strategyVersionId: previous.strategyVersionId, name: `${previous.name} / rerun`, symbol: previous.symbol, market: previous.market, requestedStart: previous.requestedStart, requestedEnd: previous.requestedEnd, actualStart: null, actualEnd: null, estimatedWork: previous.estimatedWork, profile: previous.profile, options: previous.options, dataFingerprint: dataFingerprint(previous.symbol, version.configuration.requiredTimeframes, previous.requestedStart, previous.requestedEnd, strategyWarmupBars(version.configuration)), configurationHash: previous.configurationHash, engineVersion: SIMULATION_ENGINE_VERSION, metricsVersion: METRICS_ENGINE_VERSION, monteCarloEngineVersion: MONTE_CARLO_ENGINE_VERSION, walkForwardEngineVersion: WALK_FORWARD_ENGINE_VERSION, robustnessEngineVersion: ROBUSTNESS_ENGINE_VERSION, stressEngineVersion: STRESS_ENGINE_VERSION, exportVersion: VERIFICATION_EXPORT_VERSION, reportEngineVersion: REPORT_ENGINE_VERSION, randomSeed: previous.randomSeed }); await verificationRepository.log(clone.id, "INFO", "QUEUED", "RUN_CLONED", `Rerun cloned from ${previous.id}`); return reply.code(202).send(clone); });
  app.post("/api/verification-runs/:id/retry", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const previous = verificationRepository.get(id); if (!previous) return reply.code(404).send({ error: "Verification run not found" }); if (!["FAILED", "CANCELLED"].includes(previous.status)) return reply.code(409).send({ error: "Only failed or cancelled runs can be retried" }); const name = `${previous.name} / retry ${previous.id.slice(0, 8)}`, existing = verificationRepository.list().find((run) => run.name === name && ["QUEUED", "RUNNING", "CANCELLING"].includes(run.status)); if (existing) return reply.code(200).send(existing); const retry = await verificationRepository.create({ strategyVersionId: previous.strategyVersionId, name, symbol: previous.symbol, market: previous.market, requestedStart: previous.requestedStart, requestedEnd: previous.requestedEnd, actualStart: null, actualEnd: null, estimatedWork: previous.estimatedWork, profile: previous.profile, options: previous.options, dataFingerprint: previous.dataFingerprint, configurationHash: previous.configurationHash, engineVersion: SIMULATION_ENGINE_VERSION, metricsVersion: METRICS_ENGINE_VERSION, monteCarloEngineVersion: MONTE_CARLO_ENGINE_VERSION, walkForwardEngineVersion: WALK_FORWARD_ENGINE_VERSION, robustnessEngineVersion: ROBUSTNESS_ENGINE_VERSION, stressEngineVersion: STRESS_ENGINE_VERSION, exportVersion: VERIFICATION_EXPORT_VERSION, reportEngineVersion: REPORT_ENGINE_VERSION, randomSeed: previous.randomSeed }); await verificationRepository.log(retry.id, "INFO", "QUEUED", "RUN_RETRY_CREATED", `Retry cloned from ${previous.id}`); return reply.code(202).send(retry); });
  app.get("/api/verification-runs/:id", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" }); const version = strategyRepository.version(run.strategyVersionId), strategy = version ? strategyRepository.get(version.strategyId) : null; return { ...run, strategy, strategyVersion: version, researchSource: strategy?.sourceResearchRunId ? { researchRunId: strategy.sourceResearchRunId, candidateId: strategy.sourceCandidateId, normalizedHash: strategy.sourceNormalizedHash } : null, result: verificationRepository.result(id), logs: verificationRepository.logs(id) }; });
  app.get("/api/verification-runs/:id/summary.json", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" }); const version = strategyRepository.version(run.strategyVersionId), result = verificationRepository.result(id); return reply.header("Content-Disposition", `attachment; filename=verification-${id}-summary.json`).type("application/json; charset=utf-8").send({ run, strategyVersion: version ? { id: version.id, versionNumber: version.versionNumber, configurationHash: version.configurationHash, configuration: version.configuration } : null, result, logs: verificationRepository.logs(id) }); });
  app.get("/api/verification-runs/:id/report.pdf", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id), result = verificationRepository.result(id); if (!run || !result) return reply.code(404).send({ error: "Completed verification report not found" }); const reportRun = await markVerificationComponent(id, "reportEngineVersion", REPORT_ENGINE_VERSION) ?? run, version = strategyRepository.version(reportRun.strategyVersionId), trades = verificationRepository.trades(id, 1_000_000, 0) as Array<Record<string, unknown>>, audit = auditVerificationRun({ run: reportRun, result, trades, costs: version?.configuration.costs, currentEngineVersion: SIMULATION_ENGINE_VERSION, currentMetricsVersion: METRICS_ENGINE_VERSION, currentMonteCarloVersion: MONTE_CARLO_ENGINE_VERSION, currentExportVersion: VERIFICATION_EXPORT_VERSION, currentWalkForwardVersion: WALK_FORWARD_ENGINE_VERSION, currentRobustnessVersion: ROBUSTNESS_ENGINE_VERSION, currentStressVersion: STRESS_ENGINE_VERSION, currentReportVersion: REPORT_ENGINE_VERSION }); const pdf = await verificationReportPdf({ run: reportRun, version, result, audit, trades, logs: verificationRepository.logs(id) as Array<Record<string, unknown>> }); return reply.header("Content-Disposition", `attachment; filename=treidin-verification-${id}.pdf`).type("application/pdf").send(pdf); });
  app.get("/api/verification-runs/:id/trades", async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const query = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(250), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query); return verificationRepository.trades(id, query.limit, query.offset); });
  app.get("/api/verification-runs/:id/trades.csv", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" }); const exportRun = await markVerificationComponent(id, "exportVersion", VERIFICATION_EXPORT_VERSION) ?? run, version = strategyRepository.version(exportRun.strategyVersionId); const metadata = { configurationHash: exportRun.configurationHash, indicatorRegistryVersion: version?.indicatorRegistryVersion, engineVersion: exportRun.engineVersion, metricsVersion: exportRun.metricsVersion, monteCarloEngineVersion: exportRun.monteCarloEngineVersion, walkForwardEngineVersion: exportRun.walkForwardEngineVersion, robustnessEngineVersion: exportRun.robustnessEngineVersion, stressEngineVersion: exportRun.stressEngineVersion, exportVersion: exportRun.exportVersion, reportEngineVersion: exportRun.reportEngineVersion, randomSeed: exportRun.randomSeed }; reply.hijack(); reply.raw.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=verification-${id}-trades.csv`, "Cache-Control": "no-store" }); const write = async (chunk: string) => { if (!reply.raw.write(chunk)) await once(reply.raw, "drain"); }; await write(tradeCsvHeader()); for (const row of verificationRepository.iterateTrades(id)) await write(tradeCsvLine(exportRun.id, exportRun.strategyVersionId, row, metadata)); reply.raw.end(); });
  app.get("/api/verification-runs/:id/audit", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" }); const version = strategyRepository.version(run.strategyVersionId), audit = auditVerificationRun({ run, result: verificationRepository.result(id), trades: verificationRepository.trades(id, 1_000_000, 0) as Array<Record<string, unknown>>, costs: version?.configuration.costs, currentEngineVersion: SIMULATION_ENGINE_VERSION, currentMetricsVersion: METRICS_ENGINE_VERSION, currentMonteCarloVersion: MONTE_CARLO_ENGINE_VERSION, currentExportVersion: VERIFICATION_EXPORT_VERSION, currentWalkForwardVersion: WALK_FORWARD_ENGINE_VERSION, currentRobustnessVersion: ROBUSTNESS_ENGINE_VERSION, currentStressVersion: STRESS_ENGINE_VERSION, currentReportVersion: REPORT_ENGINE_VERSION }); await verificationRepository.updateAuditStatus(id, audit.status); return audit; });
  app.get("/api/verification-runs/:id/metrics.csv", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id), result = verificationRepository.result(id); if (!run || !result) return reply.code(404).send({ error: "Verification result not found" }); const exportRun = await markVerificationComponent(id, "exportVersion", VERIFICATION_EXPORT_VERSION) ?? run, version = strategyRepository.version(exportRun.strategyVersionId), escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`, metadata: Record<string, unknown> = { run_id: exportRun.id, strategy_version_id: exportRun.strategyVersionId, configuration_hash: exportRun.configurationHash, indicator_registry_version: version?.indicatorRegistryVersion, simulation_engine_version: exportRun.engineVersion, metrics_engine_version: exportRun.metricsVersion, monte_carlo_engine_version: exportRun.monteCarloEngineVersion, walk_forward_engine_version: exportRun.walkForwardEngineVersion, robustness_engine_version: exportRun.robustnessEngineVersion, stress_engine_version: exportRun.stressEngineVersion, export_engine_version: exportRun.exportVersion, report_engine_version: exportRun.reportEngineVersion, random_seed: exportRun.randomSeed }; const csv = ["metric,value", ...Object.entries(metadata).map(([key, value]) => `${escape(`run.${key}`)},${escape(value)}`), ...Object.entries(result.metrics as Record<string, unknown>).filter(([, value]) => typeof value !== "object").map(([key, value]) => `${escape(key)},${escape(value)}`)].join("\n"); return reply.header("Content-Disposition", `attachment; filename=verification-${id}-metrics.csv`).type("text/csv; charset=utf-8").send(csv); });
  app.get("/api/verification-runs/:id/breakdowns.csv", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id), result = verificationRepository.result(id); if (!run || !result) return reply.code(404).send({ error: "Verification result not found" }); const exportRun = await markVerificationComponent(id, "exportVersion", VERIFICATION_EXPORT_VERSION) ?? run, version = strategyRepository.version(exportRun.strategyVersionId), escape = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`, rows: string[] = ["section,key,value_json"]; const metadata: Record<string, unknown> = { run_id: exportRun.id, strategy_version_id: exportRun.strategyVersionId, configuration_hash: exportRun.configurationHash, indicator_registry_version: version?.indicatorRegistryVersion, simulation_engine_version: exportRun.engineVersion, metrics_engine_version: exportRun.metricsVersion, monte_carlo_engine_version: exportRun.monteCarloEngineVersion, walk_forward_engine_version: exportRun.walkForwardEngineVersion, robustness_engine_version: exportRun.robustnessEngineVersion, stress_engine_version: exportRun.stressEngineVersion, export_engine_version: exportRun.exportVersion, report_engine_version: exportRun.reportEngineVersion, random_seed: exportRun.randomSeed }; Object.entries(metadata).forEach(([key, value]) => rows.push(`${escape("run" )},${escape(key)},${escape(JSON.stringify(value))}`)); for (const [section, value] of Object.entries(result.breakdowns as Record<string, unknown>)) { if (Array.isArray(value)) value.forEach((item, index) => rows.push(`${escape(section)},${escape(index)},${escape(JSON.stringify(item))}`)); else if (value && typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([key, item]) => rows.push(`${escape(section)},${escape(key)},${escape(JSON.stringify(item))}`)); else rows.push(`${escape(section)},${escape("value")},${escape(value)}`); } return reply.header("Content-Disposition", `attachment; filename=verification-${id}-breakdowns.csv`).type("text/csv; charset=utf-8").send(rows.join("\n")); });
  app.post("/api/verification-runs/:id/recalculate-metrics", async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" }); const version = strategyRepository.version(run.strategyVersionId), result = verificationRepository.result(id); if (!version || !result) return reply.code(409).send({ error: "A persisted result and strategy version are required" }); const rows = verificationRepository.trades(id, 1_000_000, 0) as Array<Record<string, unknown>>, trades = rows.map(persistedTradeToSimTrade), initial = Number(run.options.initialBalance), equity = reconstructedBalanceCurve(initial, trades), recalculated = verificationMetrics(trades, equity), feeAudit = auditVerificationRun({ run, result, trades: rows, costs: version.configuration.costs, currentEngineVersion: SIMULATION_ENGINE_VERSION, currentMetricsVersion: METRICS_ENGINE_VERSION, currentMonteCarloVersion: MONTE_CARLO_ENGINE_VERSION, currentExportVersion: VERIFICATION_EXPORT_VERSION, currentWalkForwardVersion: WALK_FORWARD_ENGINE_VERSION, currentRobustnessVersion: ROBUSTNESS_ENGINE_VERSION, currentStressVersion: STRESS_ENGINE_VERSION, currentReportVersion: REPORT_ENGINE_VERSION }).feeAudit; const metrics = { ...recalculated, feeAudit: feeAudit ? { ...feeAudit, feesPctInitialBalance: initial ? feeAudit.totalFees / initial * 100 : null, feesPctGrossTradingPnl: recalculated.grossPnl ? feeAudit.totalFees / Math.abs(recalculated.grossPnl) * 100 : null } : undefined }; await verificationRepository.storeResult(id, { metrics, equityCurve: equity, breakdowns: result.breakdowns, scorecard: scorecard(metrics, (result.warnings ?? []) as string[]), funnel: result.funnel, warnings: result.warnings }); await verificationRepository.update(id, { metricsVersion: METRICS_ENGINE_VERSION }); await verificationRepository.log(id, "INFO", "METRICS", "METRICS_RECALCULATED", "Metrics recalculated from persisted trades without rerunning simulation"); return { run: verificationRepository.get(id), metrics, audit: feeAudit }; });
  app.get("/api/verification-runs/:id/replay", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = z.object({ sequence: z.coerce.number().int().positive(), padding: z.coerce.number().int().min(20).max(2000).default(180) }).parse(request.query);
    const run = verificationRepository.get(id); if (!run) return reply.code(404).send({ error: "Verification run not found" });
    const version = strategyRepository.version(run.strategyVersionId); if (!version) return reply.code(404).send({ error: "Strategy version not found" });
    const trade = verificationRepository.trade(id, query.sequence); if (!trade) return reply.code(404).send({ error: "Trade not found" });
    const timeframe = version.configuration.executionTimeframe, step = intervalMs(timeframe), start = new Date(Number(trade.entry_time) - query.padding * step), end = new Date(Number(trade.exit_time) + query.padding * step);
    const candles = candleRepository.verificationRange(run.symbol, timeframe, start, end);
    const references = new Map<string, { indicator: string; parameters: Record<string, unknown>; output?: string }>();
    const visit = (node: unknown) => { if (!node || typeof node !== "object") return; const value = node as Record<string, unknown>; if (value.type === "indicator") { const indicator = String(value.indicator), parameters = (value.parameters ?? {}) as Record<string, unknown>, output = value.output ? String(value.output) : undefined; references.set(`${indicator}:${JSON.stringify(parameters)}:${output ?? ""}`, { indicator, parameters, output }); } if (Array.isArray(value.children)) value.children.forEach(visit); if (value.left) visit(value.left); if (value.right) { if (Array.isArray(value.right)) value.right.forEach(visit); else visit(value.right); } };
    [version.configuration.longEntry, version.configuration.shortEntry, version.configuration.longExit, version.configuration.shortExit].forEach(visit);
    const overlays = [...references.values()].flatMap((ref) => { const definition = indicatorRegistry[ref.indicator]; if (!definition || definition.visualization !== "overlay") return []; const output = ref.output ?? definition.outputs[0], values = calculateIndicator(ref.indicator, candles, ref.parameters)[output]; if (!values) return []; return [{ id: `${ref.indicator}:${JSON.stringify(ref.parameters)}:${output}`, label: `${definition.name} (${Object.values(ref.parameters).join(", ") || "default"})`, values: candles.flatMap((c, index) => Number.isFinite(values[index]) ? [{ time: Math.floor(c.openTime.getTime() / 1000), value: values[index] }] : []) }]; });
    return { symbol: run.symbol, timeframe, trade, candles, overlays };
  });
  app.post("/api/verification-runs/:id/cancel", async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); return verificationRepository.cancel(id); });
  app.get("/api/jobs", async () => jobRepository.list());
  app.post("/api/jobs", async (request, reply) => {
    const body = z
      .object({
        symbol,
        timeframe: z.string(),
        startTime: date,
        endTime: date.optional(),
        untilNow: z.boolean().default(true),
      })
      .parse(request.body);
    const job = await backfillWorker.create(body);
    return reply.code(202).send(job);
  });
  app.post("/api/jobs/:id/cancel", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return jobRepository.update(id, {
      status: "CANCELLING",
      cancelRequested: true,
    });
  });
  app.post("/api/jobs/:id/pause", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return jobRepository.update(id, { status: "PAUSED" });
  });
  app.post("/api/jobs/:id/retry", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return jobRepository.update(id, {
      status: "PENDING",
      cancelRequested: false,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    });
  });
  app.get("/api/gaps", async (request) => {
    const { active } = z
      .object({ active: z.coerce.boolean().default(false) })
      .parse(request.query);
    return gapRepository.list(active);
  });
  app.post("/api/gaps/scan", async (request) => {
    const body = z
      .object({
        symbol,
        timeframe: z.string().default("1m"),
        start: date,
        end: date,
      })
      .parse(request.body);
    return gapService.scan(body.symbol, body.timeframe, body.start, body.end);
  });
  app.post("/api/gaps/repair", async (_request, reply) => {
    void gapRepairWorker.runOnce();
    return reply.code(202).send({ accepted: true });
  });
  app.post("/api/aggregations/rebuild", async (request, reply) => {
    const body = z
      .object({ symbol, timeframe: z.string(), start: date, end: date })
      .parse(request.body);
    void aggregationEngine.rebuild(
      body.symbol,
      body.timeframe,
      body.start,
      body.end,
    );
    return reply.code(202).send({ accepted: true });
  });
  app.post("/api/aggregations/reconcile", async () => ({
    rebuilt: await aggregationEngine.reconcileIncomplete(),
  }));
  app.get("/api/metadata", async () => metadataRepository.list());
  app.post("/api/metadata/refresh", async () => ({
    refreshed: await refreshMetadata(config.symbols),
  }));
  app.get("/api/events", async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(2000).default(500) })
      .parse(request.query);
    return eventRepository.list(limit);
  });
  app.get("/api/events/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    reply.raw.write(
      `event: ready\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = eventBus.on((event) =>
      reply.raw.write(
        `event: market-event\ndata: ${JSON.stringify(event)}\n\n`,
      ),
    );
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      15_000,
    );
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.get("/api/health", async () => {
    const db = databaseOverview();
    const components = {
      application: "HEALTHY",
      sqlite: db.integrity === "ok" ? "HEALTHY" : "UNHEALTHY",
      writer: db.writer.queueDepth < 100 ? "HEALTHY" : "DEGRADED",
      binanceRest: liveState.restHealthy ? "HEALTHY" : "UNHEALTHY",
      binanceWebSocket: !liveState.websocketConnected
        ? "UNHEALTHY"
        : liveState.websocketFresh()
          ? "HEALTHY"
          : "DEGRADED",
      historicalWorker: backfillWorker.healthy ? "HEALTHY" : "DEGRADED",
      gapRepair: gapRepairWorker.healthy ? "HEALTHY" : "DEGRADED",
      aggregation: aggregationEngine.healthy ? "HEALTHY" : "DEGRADED",
      liveIngestion: liveIngestionWorker.healthy ? "HEALTHY" : "SYNCING",
    };
    const overall =
      Object.values(components).every((v) => v === "HEALTHY") &&
      gapRepository.list(true).length === 0
        ? "HEALTHY"
        : Object.values(components).includes("UNHEALTHY")
          ? "UNHEALTHY"
          : "DEGRADED";
    return { status: overall, components, checkedAt: new Date().toISOString() };
  });
  app.get("/api/symbols", async () => ({
    enabled: config.symbols,
    metadata: metadataRepository.list(),
  }));
  app.get("/api/settings", async () => ({
    effective: runtimeSettings(),
    saved: systemStateRepository.get("runtime-settings") ?? runtimeSettings(),
  }));
  app.put("/api/settings", async (request) => {
    const settings = z
      .object({
        symbols: z.array(symbol).min(1).max(50),
        aggregatedTimeframes: z
          .array(z.enum(["5m", "15m", "1h", "4h", "1d", "1w"]))
          .min(1),
        eventRetentionDays: z.coerce.number().int().min(1).max(3650),
        streamsEnabled: z.boolean(),
      })
      .parse(request.body);
    const clean = {
      ...settings,
      symbols: [...new Set(settings.symbols)],
      aggregatedTimeframes: [...new Set(settings.aggregatedTimeframes)],
    };
    await systemStateRepository.set("runtime-settings", clean);
    await eventBus.emit({
      level: "INFO",
      component: "settings",
      event: "SETTINGS_SAVED",
      message:
        "Runtime settings saved; restart required to apply stream changes",
    });
    return { saved: clean, restartRequired: true };
  });
  app.get("/api/database", async () => databaseOverview());
  app.post("/api/database/checkpoint", async () => ({
    result: await checkpoint("PASSIVE"),
  }));
  app.post("/api/database/optimize", async () => optimize());
  app.post("/api/database/backup", async () => backup());
  app.get("/metrics", async (_request, reply) =>
    reply.type(metrics.contentType).send(await metrics.metrics()),
  );
}
