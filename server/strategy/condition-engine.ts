import type { FeatureEngine, FeatureRequest } from "./feature-engine.js";
import type { ConditionNode, LeafCondition, ValueRef } from "./model.js";

export type ConditionEvaluationStatus = "TRUE" | "FALSE" | "EXPECTED_WARMUP_MISSING" | "MISSING_REQUIRED_DATA" | "NON_FINITE_VALUE" | "FEATURE_CALCULATION_ERROR" | "EVALUATION_ERROR";
export type ConditionResult = { passed: boolean; status: ConditionEvaluationStatus; reason?: string; diagnostic?: unknown };
function request(ref: Extract<ValueRef, { type: "indicator" | "feature" }>): FeatureRequest { return ref.type === "indicator" ? { indicator: ref.indicator, parameters: ref.parameters, timeframe: ref.timeframe, output: ref.output } : { indicator: ref.feature, timeframe: ref.timeframe }; }
export function resolveValue(ref: ValueRef, engine: FeatureEngine, asOf: Date, previous = false): number {
  if (ref.type === "constant") return ref.value;
  if (ref.type === "price") return engine.price(ref.field, ref.timeframe ?? "1m", asOf);
  return previous ? engine.previousValue(request(ref), asOf) : engine.value(request(ref), asOf);
}
const resolve = resolveValue;
function result(passed: boolean): ConditionResult { return { passed, status: passed ? "TRUE" : "FALSE" }; }
function leaf(node: LeafCondition, engine: FeatureEngine, asOf: Date): ConditionResult {
  let left: number, right: number | number[] | undefined;
  try {
    left = resolve(node.left, engine, asOf);
    right = Array.isArray(node.right) ? node.right.map((v) => resolve(v, engine, asOf)) : node.right ? resolve(node.right, engine, asOf) : undefined;
  } catch (error) {
    return { passed: false, status: "FEATURE_CALCULATION_ERROR", reason: error instanceof Error ? error.message : "Feature calculation failed", diagnostic: error };
  }
  const refs = [node.left, ...(Array.isArray(node.right) ? node.right : node.right ? [node.right] : [])];
  const nonFinite = !Number.isFinite(left) || (typeof right === "number" && !Number.isFinite(right)) || (Array.isArray(right) && right.some((x) => !Number.isFinite(x)));
  if (nonFinite) {
    const availability = refs.map((ref) => engine.referenceAvailability(ref, asOf));
    const status = availability.includes("MISSING_REQUIRED_DATA") ? "MISSING_REQUIRED_DATA" : availability.includes("EXPECTED_WARMUP_MISSING") ? "EXPECTED_WARMUP_MISSING" : "NON_FINITE_VALUE";
    return { passed: false, status, reason: status, diagnostic: { operator: node.operator, availability } };
  }
  try {
    switch (node.operator) {
      case ">": return result(left > Number(right)); case ">=": return result(left >= Number(right)); case "<": return result(left < Number(right)); case "<=": return result(left <= Number(right)); case "==": return result(left === Number(right)); case "!=": return result(left !== Number(right));
      case "is_true": return result(Boolean(left)); case "is_false": return result(!Boolean(left));
      case "between": { const bounds = right as number[]; return result(left >= bounds[0] && left <= bounds[1]); } case "outside": { const bounds = right as number[]; return result(left < bounds[0] || left > bounds[1]); }
      case "crosses_above": { if (!node.right || Array.isArray(node.right)) return { passed: false, status: "EVALUATION_ERROR", reason: "CROSS_REQUIRES_SCALAR_RIGHT" }; return result(resolve(node.left, engine, asOf, true) <= resolve(node.right, engine, asOf, true) && left > Number(right)); }
      case "crosses_below": { if (!node.right || Array.isArray(node.right)) return { passed: false, status: "EVALUATION_ERROR", reason: "CROSS_REQUIRES_SCALAR_RIGHT" }; return result(resolve(node.left, engine, asOf, true) >= resolve(node.right, engine, asOf, true) && left < Number(right)); }
    }
  } catch (error) {
    return { passed: false, status: "EVALUATION_ERROR", reason: error instanceof Error ? error.message : "Condition evaluation failed", diagnostic: error };
  }
}
export function evaluateCondition(node: ConditionNode | undefined, engine: FeatureEngine, asOf: Date): ConditionResult {
  if (!node) return { passed: false, status: "FALSE", reason: "NO_CONDITION" };
  if (!("type" in node)) return leaf(node, engine, asOf);
  const results = node.children.map((child) => evaluateCondition(child, engine, asOf));
  const errorResult = results.find((item) => !["TRUE", "FALSE"].includes(item.status));
  if (errorResult) return errorResult;
  if (node.operator === "NOT") return result(!results[0].passed);
  return result(node.operator === "AND" ? results.every((r) => r.passed) : results.some((r) => r.passed));
}
