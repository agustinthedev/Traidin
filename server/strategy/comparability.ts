import type { StrategyConfig } from "./model.js";

type RunLike = { symbol: string; market: string; requestedStart: Date; requestedEnd: Date; actualStart?: Date | null; actualEnd?: Date | null; strategyVersionId: string; configurationHash: string; randomSeed: number; options: Record<string, unknown>; dataFingerprint: Record<string, unknown>; engineVersion: string; metricsVersion: string; monteCarloEngineVersion?: string | null; walkForwardEngineVersion?: string | null; robustnessEngineVersion?: string | null; stressEngineVersion?: string | null; exportVersion?: string | null; reportEngineVersion?: string | null };

const indicatorTimeframes = (config: StrategyConfig) => {
  const values: string[] = [];
  const visit = (value: unknown) => { if (!value || typeof value !== "object") return; if (Array.isArray(value)) return value.forEach(visit); const row = value as Record<string, unknown>; if (row.type === "indicator" && typeof row.timeframe === "string") values.push(row.timeframe); Object.values(row).forEach(visit); };
  [config.longEntry, config.shortEntry, config.longExit, config.shortExit].forEach(visit);
  return [...new Set(values)].sort();
};
const comparableValue = (value: unknown) => value instanceof Date ? value.toISOString() : JSON.stringify(value ?? null);

export function compareVerificationRuns(left: RunLike, right: RunLike, leftConfig: StrategyConfig, rightConfig: StrategyConfig) {
  const differences: Array<{ field: string; left: unknown; right: unknown }> = [];
  const compare = (field: string, a: unknown, b: unknown) => { if (comparableValue(a) !== comparableValue(b)) differences.push({ field, left: a, right: b }); };
  compare("requested_range", [left.requestedStart, left.requestedEnd], [right.requestedStart, right.requestedEnd]);
  compare("actual_range", [left.actualStart, left.actualEnd], [right.actualStart, right.actualEnd]);
  compare("symbol", left.symbol, right.symbol); compare("market", left.market, right.market); compare("strategy_version", left.strategyVersionId, right.strategyVersionId); compare("configuration_hash", left.configurationHash, right.configurationHash);
  compare("trigger_timeframe", leftConfig.triggerTimeframe, rightConfig.triggerTimeframe); compare("indicator_timeframes", indicatorTimeframes(leftConfig), indicatorTimeframes(rightConfig)); compare("execution_timeframe", leftConfig.executionTimeframe, rightConfig.executionTimeframe); compare("required_timeframes", leftConfig.requiredTimeframes, rightConfig.requiredTimeframes);
  compare("fees", leftConfig.costs, rightConfig.costs); compare("slippage", leftConfig.costs.slippageBps, rightConfig.costs.slippageBps); compare("funding", { mode: leftConfig.costs.fundingMode, rate: leftConfig.costs.fixedFundingPct }, { mode: rightConfig.costs.fundingMode, rate: rightConfig.costs.fixedFundingPct }); compare("initial_balance", left.options.initialBalance, right.options.initialBalance); compare("random_seed", left.randomSeed, right.randomSeed);
  compare("engine_versions", { simulation: left.engineVersion, metrics: left.metricsVersion, monteCarlo: left.monteCarloEngineVersion, walkForward: left.walkForwardEngineVersion, robustness: left.robustnessEngineVersion, stress: left.stressEngineVersion, export: left.exportVersion, report: left.reportEngineVersion }, { simulation: right.engineVersion, metrics: right.metricsVersion, monteCarlo: right.monteCarloEngineVersion, walkForward: right.walkForwardEngineVersion, robustness: right.robustnessEngineVersion, stress: right.stressEngineVersion, export: right.exportVersion, report: right.reportEngineVersion });
  compare("data_fingerprint", left.dataFingerprint, right.dataFingerprint);
  const notDirect = differences.some((item) => ["symbol", "market"].includes(item.field));
  return { status: notDirect ? "NOT_DIRECTLY_COMPARABLE" : differences.length ? "COMPARABLE_WITH_DIFFERENCES" : "EXACTLY_COMPARABLE", differences } as const;
}
