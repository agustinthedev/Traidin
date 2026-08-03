import { createHash } from "node:crypto";
import { canonicalJson, type ConditionNode } from "./model.js";

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return typeof value === "number" ? Number(value.toFixed(10)) : value;
  const source = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(source).sort().map((key) => [key, normalizeValue(source[key])]));
}
function conditionKey(value: unknown) { return canonicalJson(value); }
export function normalizeCondition(node: ConditionNode): ConditionNode {
  if (!("type" in node)) {
    const normalized = normalizeValue(node) as typeof node;
    const reversible: Record<string, string> = { ">": "<", ">=": "<=", "<": ">", "<=": ">=" };
    if (normalized.right && !Array.isArray(normalized.right) && reversible[normalized.operator] && conditionKey(normalized.left) > conditionKey(normalized.right)) return { ...normalized, left: normalized.right, operator: reversible[normalized.operator] as typeof normalized.operator, right: normalized.left };
    return normalized;
  }
  const children = node.children.flatMap((child) => child && "type" in child && child.operator === node.operator && ["AND", "OR"].includes(node.operator) ? child.children : [child]).map(normalizeCondition);
  if (node.operator === "AND" || node.operator === "OR") {
    const unique = [...new Map(children.map((child) => [conditionKey(child), child])).values()].sort((left, right) => conditionKey(left).localeCompare(conditionKey(right)));
    return { ...node, children: unique };
  }
  return { ...node, children };
}
export function normalizedCandidateHash(ast: Record<string, unknown>) {
  const normalized = normalizeValue({ ...ast, longEntry: ast.longEntry ? normalizeCondition(ast.longEntry as ConditionNode) : undefined, shortEntry: ast.shortEntry ? normalizeCondition(ast.shortEntry as ConditionNode) : undefined, longExit: ast.longExit ? normalizeCondition(ast.longExit as ConditionNode) : undefined, shortExit: ast.shortExit ? normalizeCondition(ast.shortExit as ConditionNode) : undefined }) as Record<string, unknown>;
  const canonical = canonicalJson(normalized);
  return { normalized, canonical, hash: createHash("sha256").update(canonical).digest("hex"), semanticFingerprint: createHash("sha256").update(canonical).digest("hex") };
}
export function semanticFingerprint(ast: Record<string, unknown>) { return normalizedCandidateHash(ast).semanticFingerprint; }
export function complexityOf(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const source = node as Record<string, unknown>;
  if (Array.isArray(source.children)) return 1 + source.children.reduce((sum, child) => sum + complexityOf(child), 0);
  return "operator" in source ? 1 : Object.values(source).reduce<number>((sum, child) => sum + complexityOf(child), 0);
}
