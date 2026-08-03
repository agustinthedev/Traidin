import type { FeatureEngine, FeatureRequest } from "./feature-engine.js";
import type { ConditionNode, LeafCondition, ValueRef } from "./model.js";

export type ConditionResult = { passed: boolean; reason?: string };
function request(ref: Extract<ValueRef, { type: "indicator" | "feature" }>): FeatureRequest { return ref.type === "indicator" ? { indicator: ref.indicator, parameters: ref.parameters, timeframe: ref.timeframe, output: ref.output } : { indicator: ref.feature, timeframe: ref.timeframe }; }
export function resolveValue(ref: ValueRef, engine: FeatureEngine, asOf: Date, previous = false): number {
  if (ref.type === "constant") return ref.value;
  if (ref.type === "price") return engine.price(ref.field, ref.timeframe ?? "1m", asOf);
  return previous ? engine.previousValue(request(ref), asOf) : engine.value(request(ref), asOf);
}
const resolve = resolveValue;
function leaf(node: LeafCondition, engine: FeatureEngine, asOf: Date): ConditionResult {
  const left = resolve(node.left, engine, asOf), right = Array.isArray(node.right) ? node.right.map((v) => resolve(v, engine, asOf)) : node.right ? resolve(node.right, engine, asOf) : undefined;
  if (!Number.isFinite(left) || (typeof right === "number" && !Number.isFinite(right)) || (Array.isArray(right) && right.some((x) => !Number.isFinite(x)))) return { passed: false, reason: "FEATURE_UNAVAILABLE_OR_WARMUP" };
  switch (node.operator) {
    case ">": return { passed: left > Number(right) }; case ">=": return { passed: left >= Number(right) }; case "<": return { passed: left < Number(right) }; case "<=": return { passed: left <= Number(right) }; case "==": return { passed: left === Number(right) }; case "!=": return { passed: left !== Number(right) };
    case "is_true": return { passed: Boolean(left) }; case "is_false": return { passed: !Boolean(left) };
    case "between": { const bounds = right as number[]; return { passed: left >= bounds[0] && left <= bounds[1] }; } case "outside": { const bounds = right as number[]; return { passed: left < bounds[0] || left > bounds[1] }; }
    case "crosses_above": { if (!node.right || Array.isArray(node.right)) return { passed: false, reason: "CROSS_REQUIRES_SCALAR_RIGHT" }; return { passed: resolve(node.left, engine, asOf, true) <= resolve(node.right, engine, asOf, true) && left > Number(right) }; }
    case "crosses_below": { if (!node.right || Array.isArray(node.right)) return { passed: false, reason: "CROSS_REQUIRES_SCALAR_RIGHT" }; return { passed: resolve(node.left, engine, asOf, true) >= resolve(node.right, engine, asOf, true) && left < Number(right) }; }
  }
}
export function evaluateCondition(node: ConditionNode | undefined, engine: FeatureEngine, asOf: Date): ConditionResult {
  if (!node) return { passed: false, reason: "NO_CONDITION" };
  if (!("type" in node)) return leaf(node, engine, asOf);
  const results = node.children.map((child) => evaluateCondition(child, engine, asOf));
  if (node.operator === "NOT") return { passed: !results[0].passed, reason: results[0].reason };
  return node.operator === "AND" ? { passed: results.every((r) => r.passed), reason: results.find((r) => !r.passed)?.reason } : { passed: results.some((r) => r.passed), reason: results.every((r) => !r.passed) ? results[0]?.reason : undefined };
}
