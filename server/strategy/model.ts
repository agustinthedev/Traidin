import { createHash } from "node:crypto";
import { z } from "zod";
import { indicatorRegistry, validateIndicator } from "./indicators.js";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
export const TIMEFRAME_MINUTES: Record<(typeof TIMEFRAMES)[number], number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440, "1w": 10080 };
export const StrategyStatus = z.enum(["DRAFT", "READY_FOR_VERIFICATION", "VERIFIED", "VERIFICATION_WARNING", "VERIFICATION_FAILED", "ARCHIVED"]);
export type StrategyStatus = z.infer<typeof StrategyStatus>;
export const StrategyOrigin = z.enum(["MANUAL", "STRATEGY_LAB"]);
export type StrategyOrigin = z.infer<typeof StrategyOrigin>;
export const StrategyLifecycle = z.enum(["DRAFT", "READY_FOR_DEEP_VERIFICATION", "VERIFIED", "RETIRED"]);
export type StrategyLifecycle = z.infer<typeof StrategyLifecycle>;

const timeframe = z.enum(TIMEFRAMES);
const valueRef = z.discriminatedUnion("type", [
  z.object({ type: z.literal("constant"), value: z.number() }),
  z.object({ type: z.literal("price"), field: z.enum(["open", "high", "low", "close"]), timeframe: timeframe.optional() }),
  z.object({ type: z.literal("indicator"), indicator: z.string().min(1), parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}), timeframe: timeframe, output: z.string().optional() }),
  z.object({ type: z.literal("feature"), feature: z.string().min(1), timeframe: timeframe }),
]);
export type ValueRef = z.infer<typeof valueRef>;
const condition = z.object({ left: valueRef, operator: z.enum([">", ">=", "<", "<=", "==", "!=", "crosses_above", "crosses_below", "is_true", "is_false", "between", "outside"]), right: z.union([valueRef, z.tuple([valueRef, valueRef])]).optional() });
export type LeafCondition = z.infer<typeof condition>;
export type ConditionNode = LeafCondition | { type: "group"; operator: "AND" | "OR" | "NOT"; children: ConditionNode[] };
const conditionNode: z.ZodType<ConditionNode> = z.lazy(() => z.union([condition, z.object({ type: z.literal("group"), operator: z.enum(["AND", "OR", "NOT"]), children: z.array(conditionNode).min(1) })]));

const stopPolicy = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PERCENTAGE"), percentage: z.number().positive().max(100) }),
  z.object({ type: z.literal("ATR"), timeframe, period: z.number().int().min(2).max(500), multiple: z.number().positive(), maximumDistancePct: z.number().positive().optional() }),
  z.object({ type: z.literal("STRUCTURE"), reference: z.enum(["SWING", "HIGHEST_LOW", "LOWEST_HIGH"]), lookback: z.number().int().min(2).max(500) }),
]);
const takeProfitPolicy = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  z.object({ type: z.literal("R_MULTIPLE"), multiple: z.number().positive() }),
  z.object({ type: z.literal("PERCENTAGE"), percentage: z.number().positive().max(100) }),
]);
const trailingPolicy = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  z.object({ type: z.literal("PERCENTAGE"), percentage: z.number().positive().max(100) }),
  z.object({ type: z.literal("ATR"), timeframe, period: z.number().int().min(2).max(500), multiple: z.number().positive() }),
  z.object({ type: z.literal("MOVING_AVERAGE"), indicator: z.enum(["sma", "ema"]), timeframe, period: z.number().int().min(2).max(500), offsetPct: z.number().min(0).max(100).default(0) }),
  z.object({ type: z.literal("STRUCTURE"), reference: z.enum(["SWING", "HIGHEST_LOW", "LOWEST_HIGH"]), lookback: z.number().int().min(2).max(500) }),
]);
const sizing = z.discriminatedUnion("type", [
  z.object({ type: z.literal("FIXED_NOTIONAL"), notional: z.number().positive() }),
  z.object({ type: z.literal("EQUITY_PERCENT"), percentage: z.number().positive().max(100) }),
  z.object({ type: z.literal("FIXED_RISK"), riskPct: z.number().positive().max(100) }),
  z.object({ type: z.literal("VOLATILITY_BASED"), riskPct: z.number().positive().max(100), timeframe, atrPeriod: z.number().int().min(2).max(500), targetAtrMultiple: z.number().positive().default(1) }),
]);
const entryQuality = z.object({
  maxPriceExtensionAtr: z.object({ reference: valueRef, timeframe, atrPeriod: z.number().int().min(2).max(500), maximumMultiple: z.number().positive() }).optional(),
  maxDistanceFromReference: z.object({ reference: valueRef, maximumPct: z.number().positive().max(100) }).optional(),
  maxBarsSinceBreakout: z.object({ breakout: conditionNode, maximumBars: z.number().int().min(0).max(10_000), lookbackBars: z.number().int().min(1).max(10_000).default(500) }).optional(),
  minimumNextLevelDistance: z.object({ reference: valueRef, minimumPct: z.number().positive().max(100) }).optional(),
}).default({});

export const strategyConfigSchema = z.object({
  exchange: z.literal("BINANCE"), market: z.literal("BINANCE_USDM_FUTURES"), symbols: z.array(z.string().regex(/^[A-Z0-9_]+$/)).min(1), symbolAgnostic: z.boolean().default(false),
  triggerType: z.literal("CANDLE_CLOSED").default("CANDLE_CLOSED"), triggerTimeframe: timeframe, executionTimeframe: timeframe.default("1m"), requiredTimeframes: z.array(timeframe).min(1), directions: z.enum(["LONG_ONLY", "SHORT_ONLY", "LONG_AND_SHORT"]),
  longEntry: conditionNode.optional(), shortEntry: conditionNode.optional(), longExit: conditionNode.optional(), shortExit: conditionNode.optional(),
  stop: stopPolicy, takeProfit: takeProfitPolicy, trailing: trailingPolicy.default({ type: "NONE" }), minimumRiskReward: z.number().nonnegative().default(0), entryQuality,
  sizing, leverage: z.object({ fixed: z.number().positive().max(125), maximum: z.number().positive().max(125), isolated: z.boolean().default(true) }),
  costs: z.object({ makerFeePct: z.number().min(0).max(10).default(0.02), takerFeePct: z.number().min(0).max(10).default(0.04), entryFeeType: z.enum(["MAKER", "TAKER"]).default("TAKER"), exitFeeType: z.enum(["MAKER", "TAKER"]).default("TAKER"), slippageBps: z.number().min(0).max(10_000).default(2), fundingMode: z.enum(["NONE", "FIXED"]).default("NONE"), fixedFundingPct: z.number().default(0), fillModel: z.enum(["NEXT_OPEN", "CLOSE", "WORST_CASE"]).default("NEXT_OPEN"), entryFillModel: z.enum(["NEXT_OPEN", "CLOSE", "WORST_CASE"]).optional(), exitFillModel: z.enum(["NEXT_OPEN", "CLOSE", "WORST_CASE"]).optional(), sameBarPolicy: z.enum(["STOP_FIRST", "TARGET_FIRST", "WORST_CASE"]).default("WORST_CASE") }),
  endOfTestPolicy: z.enum(["CLOSE", "LEAVE_OPEN", "EXCLUDE_UNREALIZED"]).default("CLOSE"), reversePolicy: z.literal("CLOSE_AND_WAIT").default("CLOSE_AND_WAIT"),
});
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

export const createStrategySchema = z.object({ name: z.string().min(2).max(120), description: z.string().max(4000).default(""), tags: z.array(z.string().min(1).max(40)).max(20).default([]), configuration: strategyConfigSchema, changeNotes: z.string().max(2000).default("") });
export const createRunSchema = z.object({ name: z.string().min(2).max(120), symbol: z.string().regex(/^[A-Z0-9_]+$/), start: z.coerce.date(), end: z.coerce.date(), profile: z.enum(["QUICK", "STANDARD", "FULL", "CUSTOM"]).default("STANDARD"), initialBalance: z.number().positive().default(10_000), randomSeed: z.number().int().min(0).max(2_147_483_647).default(42), monteCarloCount: z.number().int().min(0).max(10_000).default(500), oosSplit: z.number().min(0.5).max(0.9).default(0.7) });
export type VerificationRunInput = z.infer<typeof createRunSchema>;

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function configurationHash(config: StrategyConfig) { return createHash("sha256").update(canonicalJson(config)).digest("hex"); }

/** Deterministic publish/run validation with actionable errors for the Strategy Builder. */
export function validateStrategyConfiguration(config: StrategyConfig): string[] {
  const errors: string[] = [], frames = new Set(config.requiredTimeframes);
  if (TIMEFRAME_MINUTES[config.executionTimeframe] > TIMEFRAME_MINUTES[config.triggerTimeframe]) errors.push(`Execution timeframe ${config.executionTimeframe} cannot be coarser than trigger timeframe ${config.triggerTimeframe}`);
  if (!frames.has(config.triggerTimeframe)) errors.push(`Required timeframes must include trigger timeframe ${config.triggerTimeframe}`);
  if (!frames.has(config.executionTimeframe)) errors.push(`Required timeframes must include execution timeframe ${config.executionTimeframe}`);
  const reference = (ref: ValueRef, path: string) => {
    if (ref.type === "price" && ref.timeframe && !frames.has(ref.timeframe)) errors.push(`${path}: price timeframe ${ref.timeframe} is not required`);
    if (ref.type === "indicator" || ref.type === "feature") { const id = ref.type === "indicator" ? ref.indicator : ref.feature, tf = ref.timeframe; if (!frames.has(tf)) errors.push(`${path}: timeframe ${tf} is not required`); try { const definition = validateIndicator(id, ref.type === "indicator" ? ref.parameters : {}); if (ref.type === "indicator" && ref.output && !definition.outputs.includes(ref.output)) errors.push(`${path}: ${id} has no output ${ref.output}`); } catch (cause) { errors.push(`${path}: ${cause instanceof Error ? cause.message : "invalid indicator"}`); } }
  };
  const visit = (node: ConditionNode | undefined, path: string) => { if (!node) return; if ("type" in node) { if (node.operator === "NOT" && node.children.length !== 1) errors.push(`${path}: NOT requires exactly one child`); node.children.forEach((child, index) => visit(child, `${path}.${node.operator}[${index}]`)); return; } reference(node.left, `${path}.left`); if (["is_true", "is_false"].includes(node.operator)) { if (node.right) errors.push(`${path}: ${node.operator} does not accept a right operand`); return; } if (!node.right) { errors.push(`${path}: ${node.operator} requires a right operand`); return; } if (["between", "outside"].includes(node.operator)) { if (!Array.isArray(node.right)) errors.push(`${path}: ${node.operator} requires [min,max]`); else node.right.forEach((r, index) => reference(r, `${path}.right[${index}]`)); } else { if (Array.isArray(node.right)) errors.push(`${path}: ${node.operator} requires a scalar right operand`); else reference(node.right, `${path}.right`); } };
  visit(config.longEntry, "longEntry"); visit(config.shortEntry, "shortEntry"); visit(config.longExit, "longExit"); visit(config.shortExit, "shortExit");
  const quality = config.entryQuality ?? {};
  if (quality.maxPriceExtensionAtr) { const rule = quality.maxPriceExtensionAtr; reference(rule.reference, "entryQuality.maxPriceExtensionAtr.reference"); if (!frames.has(rule.timeframe)) errors.push(`Entry-quality ATR timeframe ${rule.timeframe} is not required`); }
  if (quality.maxDistanceFromReference) reference(quality.maxDistanceFromReference.reference, "entryQuality.maxDistanceFromReference.reference");
  if (quality.maxBarsSinceBreakout) visit(quality.maxBarsSinceBreakout.breakout, "entryQuality.maxBarsSinceBreakout.breakout");
  if (quality.minimumNextLevelDistance) reference(quality.minimumNextLevelDistance.reference, "entryQuality.minimumNextLevelDistance.reference");
  if (config.stop.type === "ATR" && !frames.has(config.stop.timeframe)) errors.push(`Stop ATR timeframe ${config.stop.timeframe} is not required`);
  if (config.trailing.type === "ATR" && !frames.has(config.trailing.timeframe)) errors.push(`Trailing ATR timeframe ${config.trailing.timeframe} is not required`);
  if (config.trailing.type === "MOVING_AVERAGE" && !frames.has(config.trailing.timeframe)) errors.push(`Trailing moving-average timeframe ${config.trailing.timeframe} is not required`);
  if (config.sizing.type === "VOLATILITY_BASED" && !frames.has(config.sizing.timeframe)) errors.push(`Volatility sizing timeframe ${config.sizing.timeframe} is not required`);
  if (config.minimumRiskReward > 0 && config.takeProfit.type === "NONE") errors.push("Minimum risk/reward requires a configured take-profit policy");
  if (!Object.keys(indicatorRegistry).length) errors.push("Indicator registry is unavailable");
  return errors;
}

/** Maximum closed candles required before a run's requested start, by timeframe. */
export function strategyWarmupBars(config: StrategyConfig): Record<string, number> {
  const warmup = Object.fromEntries(config.requiredTimeframes.map((frame) => [frame, 0])) as Record<string, number>;
  const require = (frame: string, bars: number) => { warmup[frame] = Math.max(warmup[frame] ?? 0, Math.max(0, Math.ceil(bars))); };
  const reference = (ref: ValueRef) => {
    if (ref.type === "indicator") require(ref.timeframe, validateIndicator(ref.indicator, ref.parameters).warmupBars(ref.parameters));
    if (ref.type === "feature") require(ref.timeframe, validateIndicator(ref.feature).warmupBars({}));
  };
  const visit = (node: ConditionNode | undefined): void => { if (!node) return; if ("type" in node) { node.children.forEach(visit); return; } reference(node.left); if (node.right) (Array.isArray(node.right) ? node.right : [node.right]).forEach(reference); };
  visit(config.longEntry); visit(config.shortEntry); visit(config.longExit); visit(config.shortExit);
  const quality = config.entryQuality ?? {};
  if (quality.maxPriceExtensionAtr) { const rule = quality.maxPriceExtensionAtr; require(rule.timeframe, rule.atrPeriod); reference(rule.reference); }
  if (quality.maxDistanceFromReference) reference(quality.maxDistanceFromReference.reference);
  if (quality.maxBarsSinceBreakout) visit(quality.maxBarsSinceBreakout.breakout);
  if (quality.minimumNextLevelDistance) reference(quality.minimumNextLevelDistance.reference);
  if (config.stop.type === "ATR") require(config.stop.timeframe, config.stop.period);
  if (config.stop.type === "STRUCTURE") require(config.triggerTimeframe, config.stop.lookback);
  if (config.trailing.type === "ATR") require(config.trailing.timeframe, config.trailing.period);
  if (config.trailing.type === "MOVING_AVERAGE") require(config.trailing.timeframe, config.trailing.period);
  if (config.trailing.type === "STRUCTURE") require(config.triggerTimeframe, config.trailing.reference === "SWING" ? config.trailing.lookback * 2 + 1 : config.trailing.lookback);
  if (config.sizing.type === "VOLATILITY_BASED") require(config.sizing.timeframe, config.sizing.atrPeriod);
  return warmup;
}
