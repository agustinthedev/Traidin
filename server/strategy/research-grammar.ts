import { createHash } from "node:crypto";
import { indicatorOutputSemantics, type IndicatorOutputSemantics } from "./indicators.js";
import { canonicalJson, type ConditionNode, type LeafCondition, type StrategyConfig, type ValueRef, validateStrategyConfiguration } from "./model.js";
import type { FeatureEngine } from "./feature-engine.js";

export type ValidationIssue = { code: string; path: string; message: string; severity: "ERROR" | "WARNING" };
export type ValidationResult = { valid: boolean; issues: ValidationIssue[]; errors: string[] };
export type PreflightSignalStats = { samples: number; trueCount: number; falseCount: number; transitionCount: number; firstTrueAt: number | null; lastTrueAt: number | null; fingerprint: string; skippedWarmup: number };
export type PreflightEvaluationDiagnostic = { status: import("./condition-engine.js").ConditionEvaluationStatus; time: number; reason?: string; diagnostic?: unknown };
export type PreflightResult = { accepted: boolean; issues: ValidationIssue[]; stats: { long: PreflightSignalStats; short: PreflightSignalStats }; diagnostics: { long: PreflightEvaluationDiagnostic[]; short: PreflightEvaluationDiagnostic[] }; semanticFingerprint: string };

const error = (code: string, path: string, message: string): ValidationIssue => ({ code, path, message, severity: "ERROR" });

function semantics(ref: ValueRef): IndicatorOutputSemantics | null {
  if (ref.type === "price") return { semanticType: "PRICE_LEVEL", canBeNegative: false, priceScaled: true, percentageScaled: false, ratioScaled: false, directional: false, categorical: false, discrete: false, validOperators: [">", ">=", "<", "<=", "crosses_above", "crosses_below", "==", "between", "outside"], validOperands: ["CONSTANT", "PRICE_LEVEL", "COMPATIBLE_SERIES", "SAME_OUTPUT"], roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "TREND_FILTER"] };
  if (ref.type === "constant") return null;
  try { return indicatorOutputSemantics(ref.type === "indicator" ? ref.indicator : ref.feature, ref.type === "indicator" ? ref.output : undefined); } catch { return null; }
}

function referenceLabel(ref: ValueRef): string {
  if (ref.type === "constant") return `constant(${ref.value})`;
  if (ref.type === "price") return `price.${ref.field}`;
  return `${ref.type === "indicator" ? ref.indicator : ref.feature}.${ref.type === "indicator" ? ref.output ?? "default" : "default"}`;
}

function leaves(node: ConditionNode | undefined, path: string, result: Array<{ node: LeafCondition; path: string }>) {
  if (!node) return;
  if ("type" in node) return node.children.forEach((child, index) => leaves(child, `${path}.${node.operator}[${index}]`, result));
  result.push({ node, path });
}

function validateReference(ref: ValueRef, path: string, issues: ValidationIssue[]) {
  if (ref.type === "constant") {
    if (!Number.isFinite(ref.value)) issues.push(error("CONSTANT_NOT_FINITE", path, "Constant must be finite"));
    return;
  }
  const metadata = semantics(ref);
  if (!metadata) issues.push(error("UNKNOWN_OUTPUT_SEMANTICS", path, `${referenceLabel(ref)} does not have semantic metadata`));
}

function validateLeaf(node: LeafCondition, path: string, issues: ValidationIssue[]) {
  validateReference(node.left, `${path}.left`, issues);
  if (["is_true", "is_false"].includes(node.operator)) {
    if (node.right) issues.push(error("BOOLEAN_OPERATOR_RIGHT_OPERAND", path, `${node.operator} does not accept a right operand`));
    const left = semantics(node.left);
    if (left && left.semanticType !== "BOOLEAN") issues.push(error("BOOLEAN_OPERATOR_TYPE", path, `${node.operator} is only valid for boolean outputs`));
    return;
  }
  if (!node.right) { issues.push(error("MISSING_RIGHT_OPERAND", path, `${node.operator} requires a right operand`)); return; }
  const rights = Array.isArray(node.right) ? node.right : [node.right];
  rights.forEach((ref, index) => validateReference(ref, `${path}.right[${index}]`, issues));
  const left = semantics(node.left), right = Array.isArray(node.right) ? null : semantics(node.right);
  if (left && !left.validOperators.includes(node.operator)) issues.push(error("OPERATOR_NOT_ALLOWED", path, `${node.operator} is not valid for ${left.semanticType}`));
  if (left && right) {
    const compatible = left.semanticType === right.semanticType || (left.semanticType === "PRICE_LEVEL" && right.semanticType === "PRICE_LEVEL") || left.validOperands.includes("COMPATIBLE_SERIES");
    if (!compatible) issues.push(error("INCOMPATIBLE_OPERANDS", path, `${referenceLabel(node.left)} (${left.semanticType}) cannot be compared with ${referenceLabel(node.right as ValueRef)} (${right.semanticType})`));
    if (left.categorical !== right.categorical && ["crosses_above", "crosses_below", ">", ">=", "<", "<=", "between", "outside"].includes(node.operator)) issues.push(error("CATEGORICAL_NUMERIC_COMPARISON", path, "Categorical outputs cannot be used as numeric price or magnitude operands"));
  }
  if (!Array.isArray(node.right)) {
    const constant = node.right.type === "constant" ? node.right.value : null;
    if (constant != null && left) {
      if (left.min != null && constant < left.min || left.max != null && constant > left.max) issues.push(error("CONSTANT_OUT_OF_RANGE", path, `${referenceLabel(node.left)} threshold ${constant} is outside [${left.min}, ${left.max}]`));
      if ((["NON_NEGATIVE_MAGNITUDE", "VOLUME_LEVEL", "VOLATILITY_LEVEL"].includes(left.semanticType) || left.min != null && left.min >= 0) && [">", "<"].includes(node.operator) && constant <= (left.min ?? 0)) issues.push(error("DEGENERATE_NON_NEGATIVE_SIGN_TEST", path, `${referenceLabel(node.left)} is non-negative; a directional ${node.operator} ${constant} test is degenerate`));
      if (left.semanticType === "CALENDAR_CATEGORY" && [">", ">=", "<", "<="].includes(node.operator)) issues.push(error("ORDINAL_CALENDAR_COMPARISON", path, "Calendar categories require equality, membership, or interval templates"));
      if (left.semanticType === "CATEGORICAL_DIRECTION" && [">", ">=", "<", "<=", "crosses_above", "crosses_below"].includes(node.operator) && ![-1, 0, 1].includes(constant)) issues.push(error("INVALID_DIRECTION_STATE", path, "Directional state must be compared with -1, 0, or 1"));
    }
  } else if (!["between", "outside"].includes(node.operator)) issues.push(error("SCALAR_OPERAND_REQUIRED", path, `${node.operator} requires one right operand`));
  if (Array.isArray(node.right) && ["between", "outside"].includes(node.operator)) {
    const values = node.right.filter((ref): ref is Extract<ValueRef, { type: "constant" }> => ref.type === "constant").map((ref) => ref.value);
    if (values.length === 2 && values[0] > values[1]) issues.push(error("INVALID_INTERVAL", path, "Interval lower bound must be less than or equal to upper bound"));
  }
}

function hasDirectionalTrigger(node: ConditionNode | undefined): boolean {
  if (!node) return false;
  if ("type" in node) return node.children.some(hasDirectionalTrigger);
  const left = semantics(node.left);
  if (!left) return false;
  return left.directional || left.semanticType === "PRICE_LEVEL" && ["crosses_above", "crosses_below"].includes(node.operator) || left.semanticType === "BOOLEAN" && ["is_true", "=="].includes(node.operator);
}

function sameReference(a: ValueRef, b: ValueRef): boolean { return canonicalJson(a) === canonicalJson(b); }

export function validateCandidateSemantics(config: StrategyConfig): ValidationResult {
  const issues: ValidationIssue[] = [];
  const visit = (node: ConditionNode | undefined, path: string) => { if (!node) return; if ("type" in node) { if (node.operator === "NOT" && node.children.length !== 1) issues.push(error("NOT_ARITY", path, "NOT requires exactly one child")); node.children.forEach((child, index) => visit(child, `${path}.${node.operator}[${index}]`)); } else validateLeaf(node, path, issues); };
  const configurations = [["longEntry", config.longEntry], ["shortEntry", config.shortEntry], ["longExit", config.longExit], ["shortExit", config.shortExit]] as const;
  configurations.forEach(([name, node]) => visit(node, name));
  if (config.directions !== "SHORT_ONLY" && !config.longEntry) issues.push(error("MISSING_LONG_ENTRY", "longEntry", "Long direction requires a long entry rule"));
  if (config.directions !== "LONG_ONLY" && !config.shortEntry) issues.push(error("MISSING_SHORT_ENTRY", "shortEntry", "Short direction requires a short entry rule"));
  if (config.directions === "LONG_AND_SHORT" && config.longEntry && config.shortEntry && canonicalJson(config.longEntry) === canonicalJson(config.shortEntry)) issues.push(error("IDENTICAL_LONG_SHORT_RULES", "entry", "Long and short entries must be complementary, not identical"));
  if (config.directions !== "SHORT_ONLY" && config.longEntry && !hasDirectionalTrigger(config.longEntry)) issues.push(error("MISSING_LONG_DIRECTIONAL_TRIGGER", "longEntry", "Long entry has no directional trigger"));
  if (config.directions !== "LONG_ONLY" && config.shortEntry && !hasDirectionalTrigger(config.shortEntry)) issues.push(error("MISSING_SHORT_DIRECTIONAL_TRIGGER", "shortEntry", "Short entry has no directional trigger"));
  const longLeaves: Array<{ node: LeafCondition; path: string }> = [], shortLeaves: Array<{ node: LeafCondition; path: string }> = [];
  leaves(config.longEntry, "longEntry", longLeaves); leaves(config.shortEntry, "shortEntry", shortLeaves);
  for (const long of longLeaves) for (const short of shortLeaves) {
    if (!sameReference(long.node.left, short.node.left)) continue;
    const left = semantics(long.node.left), l = long.node.right && !Array.isArray(long.node.right) && long.node.right.type === "constant" ? long.node.right.value : null, s = short.node.right && !Array.isArray(short.node.right) && short.node.right.type === "constant" ? short.node.right.value : null;
    if (left && (["NON_NEGATIVE_MAGNITUDE", "VOLUME_LEVEL", "VOLATILITY_LEVEL"].includes(left.semanticType) || left.min != null && left.min >= 0 || left.semanticType === "CUMULATIVE_SERIES") && l === 0 && s === 0 && long.node.operator === ">" && short.node.operator === "<") issues.push(error("NAIVE_NON_NEGATIVE_DIRECTION_PAIR", "entry", `${referenceLabel(long.node.left)} cannot be used as > 0 long and < 0 short`));
  }
  try { issues.push(...validateStrategyConfiguration(config).map((message) => error("STRATEGY_CONFIGURATION", "configuration", message))); } catch (cause) { issues.push(error("STRATEGY_CONFIGURATION", "configuration", cause instanceof Error ? cause.message : "Invalid configuration")); }
  return { valid: !issues.some((issue) => issue.severity === "ERROR"), issues, errors: issues.filter((issue) => issue.severity === "ERROR").map((issue) => issue.message) };
}

function signalStats(values: boolean[], times: number[], skippedWarmup = 0): PreflightSignalStats {
  let transitions = 0; for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1]) transitions++;
  const encoded = values.map((value) => value ? "1" : "0").join("");
  return { samples: values.length, trueCount: values.filter(Boolean).length, falseCount: values.length - values.filter(Boolean).length, transitionCount: transitions, firstTrueAt: times[values.indexOf(true)] ?? null, lastTrueAt: times.length - 1 - [...values].reverse().indexOf(true) >= 0 ? times[times.length - 1 - [...values].reverse().indexOf(true)] ?? null : null, fingerprint: createHash("sha256").update(encoded).digest("hex"), skippedWarmup };
}

export function preflightCandidate(config: StrategyConfig, engine: FeatureEngine, period: { start: Date; end: Date }): PreflightResult {
  const candles = engine.candles(config.triggerTimeframe).filter((candle) => candle.closeTime >= period.start && candle.closeTime <= period.end);
  const evaluate = (node: ConditionNode | undefined) => candles.map((candle) => {
    if (!node) return { status: "FALSE" as const, passed: false, time: candle.closeTime.getTime() };
    try { const evaluated = evaluateCondition(node, engine, candle.closeTime); return { ...evaluated, time: candle.closeTime.getTime() }; }
    catch (cause) { return { status: "EVALUATION_ERROR" as const, passed: false, reason: cause instanceof Error ? cause.message : "Condition evaluation failed", diagnostic: cause, time: candle.closeTime.getTime() }; }
  });
  const collect = (outcomes: ReturnType<typeof evaluate>) => {
    const diagnostics = outcomes.filter((outcome) => outcome.status !== "TRUE" && outcome.status !== "FALSE").map((outcome) => ({ status: outcome.status, time: outcome.time, reason: outcome.reason, diagnostic: outcome.diagnostic })).slice(0, 25);
    const errors = outcomes.filter((outcome) => !["TRUE", "FALSE", "EXPECTED_WARMUP_MISSING"].includes(outcome.status));
    const usable = outcomes.filter((outcome) => outcome.status === "TRUE" || outcome.status === "FALSE");
    return { stats: signalStats(usable.map((outcome) => outcome.passed), usable.map((outcome) => outcome.time), outcomes.filter((outcome) => outcome.status === "EXPECTED_WARMUP_MISSING").length), diagnostics, errors };
  };
  const collectedLong = collect(evaluate(config.longEntry)), collectedShort = collect(evaluate(config.shortEntry));
  const long = collectedLong.stats, short = collectedShort.stats;
  const issues: ValidationIssue[] = [];
  for (const [name, collected] of [["long", collectedLong], ["short", collectedShort]] as const) {
    if (collected.errors.length) issues.push(error("PREFLIGHT_EVALUATION_ERROR", name, name + " evaluation produced " + collected.errors.length + " non-signal result(s): " + collected.errors[0]!.status));
  }
  for (const [name, stats] of [["long", long], ["short", short]] as const) {
    if (!stats.samples) issues.push(error("PREFLIGHT_NO_SAMPLES", name, "No closed candles are available in the selected period"));
    else if (!stats.trueCount) issues.push(error("PREFLIGHT_UNREACHABLE_SIGNAL", name, `${name} entry never evaluates true in the reference period`));
    else if (!stats.falseCount || !stats.transitionCount) issues.push(error("PREFLIGHT_CONSTANT_SIGNAL", name, `${name} entry is constant across the reference period`));
  }
  if (long.fingerprint === short.fingerprint) issues.push(error("PREFLIGHT_IDENTICAL_SIGNALS", "entry", "Long and short produce identical signal series"));
  return { accepted: !issues.some((issue) => issue.severity === "ERROR"), issues, stats: { long, short }, diagnostics: { long: collectedLong.diagnostics, short: collectedShort.diagnostics }, semanticFingerprint: createHash("sha256").update(long.fingerprint + ":" + short.fingerprint).digest("hex") };
}

// Kept local to avoid coupling the grammar module to simulator internals.
import { evaluateCondition } from "./condition-engine.js";
