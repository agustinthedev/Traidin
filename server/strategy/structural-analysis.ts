import { createHash } from "node:crypto";
import {
  canonicalJson,
  type ConditionNode,
  type LeafCondition,
  type ValueRef,
} from "./model.js";

export type StructuralAction = { code: string; message: string; path?: string };
export type StructuralAnalysis = {
  accepted: boolean;
  originalNormalizedHash: string;
  simplifiedNormalizedHash: string;
  simplifiedAst: Record<string, unknown>;
  actions: StructuralAction[];
  rejectionCode?: string;
  rejectionMessage?: string;
};
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const isLeaf = (node: ConditionNode): node is LeafCondition =>
  !("type" in node);
const refKey = (ref: ValueRef) => canonicalJson(ref);
const scalar = (ref: ValueRef) =>
  ref.type === "constant" && typeof ref.value === "number" ? ref.value : null;
type Bound = { value: number; inclusive: boolean; lower: boolean };

function simplifyAnd(
  node: ConditionNode,
  actions: StructuralAction[],
  path: string,
): { node: ConditionNode; rejected?: StructuralAction } {
  if (isLeaf(node)) return { node };
  if (node.operator !== "AND") return { node };
  const children = node.children.flatMap((child, index) => {
    const simplified = simplifyAnd(child, actions, `${path}.${index}`);
    if (isLeaf(simplified.node)) return [simplified.node];
    if (
      (simplified.node as { type?: string }).type === "group" &&
      (simplified.node as { children: ConditionNode[] }).children.length === 1
    )
      return [(simplified.node as { children: ConditionNode[] }).children[0]!];
    return [simplified.node];
  });
  const unique: ConditionNode[] = [],
    seen = new Set<string>();
  for (const child of children) {
    const key = canonicalJson(child);
    if (seen.has(key)) {
      actions.push({
        code: "REDUNDANT_PREDICATE_REMOVED",
        message: "Duplicate predicate removed",
        path,
      });
      continue;
    }
    seen.add(key);
    unique.push(child);
  }
  const byRef = new Map<
    string,
    { node: Exclude<ConditionNode, { type: "group" }>; bound?: Bound }[]
  >();
  for (const child of unique) {
    if (!isLeaf(child) || !child.right || Array.isArray(child.right)) continue;
    const value = scalar(child.right as ValueRef);
    if (value == null || ![">", ">=", "<", "<=", "=="].includes(child.operator))
      continue;
    const key = refKey(child.left);
    const entry = byRef.get(key) ?? [];
    const lower = child.operator === ">" || child.operator === ">=";
    entry.push({
      node: child,
      bound:
        child.operator === "=="
          ? { value, inclusive: true, lower: true }
          : {
              value,
              inclusive: child.operator === ">=" || child.operator === "<=",
              lower,
            },
    });
    byRef.set(key, entry);
  }
  for (const [key, entries] of byRef) {
    const lower = entries
      .filter((entry) => entry.bound?.lower)
      .sort(
        (a, b) =>
          b.bound!.value - a.bound!.value ||
          Number(a.bound!.inclusive) - Number(b.bound!.inclusive),
      )[0]?.bound;
    const upper = entries
      .filter((entry) => entry.bound && !entry.bound.lower)
      .sort(
        (a, b) =>
          a.bound!.value - b.bound!.value ||
          Number(a.bound!.inclusive) - Number(b.bound!.inclusive),
      )[0]?.bound;
    const equals = entries
      .filter((entry) => entry.node.operator === "==")
      .map((entry) => scalar(entry.node.right as ValueRef))
      .filter((value): value is number => value != null);
    if (
      new Set(equals).size > 1 ||
      (lower &&
        upper &&
        (lower.value > upper.value ||
          (lower.value === upper.value &&
            (!lower.inclusive || !upper.inclusive)))) ||
      (equals[0] != null &&
        ((lower &&
          (equals[0] < lower.value ||
            (equals[0] === lower.value && !lower.inclusive))) ||
          (upper &&
            (equals[0] > upper.value ||
              (equals[0] === upper.value && !upper.inclusive)))))
    ) {
      return {
        node,
        rejected: {
          code: "EMPTY_INTERVAL",
          message: `Contradictory bounds for ${key}`,
          path,
        },
      };
    }
    const strongest = new Set<ConditionNode>();
    for (const entry of entries)
      if (
        entry.bound &&
        ((entry.bound.lower && entry.bound !== lower) ||
          (!entry.bound.lower && entry.bound !== upper))
      )
        strongest.add(entry.node);
    if (strongest.size) {
      const kept = unique.filter((child) => !strongest.has(child));
      for (const removed of strongest)
        actions.push({
          code: "DOMINATED_THRESHOLD_REMOVED",
          message: `Dominated threshold removed: ${canonicalJson(removed)}`,
          path,
        });
      unique.splice(0, unique.length, ...kept);
    }
  }
  if (!unique.length) return { node };
  return {
    node:
      unique.length === 1
        ? unique[0]!
        : { type: "group", operator: "AND", children: unique },
  };
}

export function analyzeCandidateAst(
  ast: Record<string, unknown>,
): StructuralAnalysis {
  const originalNormalizedHash = hash(ast),
    actions: StructuralAction[] = [],
    simplified: Record<string, unknown> = { ...ast };
  for (const side of ["longEntry", "shortEntry"]) {
    const condition = simplified[side] as ConditionNode | undefined;
    if (!condition) continue;
    const result = simplifyAnd(condition, actions, side);
    if (result.rejected)
      return {
        accepted: false,
        originalNormalizedHash,
        simplifiedNormalizedHash: originalNormalizedHash,
        simplifiedAst: ast,
        actions,
        rejectionCode: result.rejected.code,
        rejectionMessage: result.rejected.message,
      };
    simplified[side] = result.node;
  }
  if (
    simplified.longEntry &&
    simplified.shortEntry &&
    canonicalJson(simplified.longEntry) === canonicalJson(simplified.shortEntry)
  )
    return {
      accepted: false,
      originalNormalizedHash,
      simplifiedNormalizedHash: hash(simplified),
      simplifiedAst: simplified,
      actions,
      rejectionCode: "IDENTICAL_DIRECTION_RULES",
      rejectionMessage: "Long and short directional rules are identical",
    };
  return {
    accepted: true,
    originalNormalizedHash,
    simplifiedNormalizedHash: hash(simplified),
    simplifiedAst: simplified,
    actions,
  };
}
