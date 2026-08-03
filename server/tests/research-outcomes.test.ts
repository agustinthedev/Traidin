import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../strategy/condition-engine.js";
import type { FeatureEngine } from "../strategy/feature-engine.js";
import { preflightCandidate } from "../strategy/research-grammar.js";
import { candidateConfig, resolveResearchTerminalOutcome } from "../strategy/research-worker.js";
import { researchRunSchema, strategyConfigSchema } from "../strategy/model.js";
import { describeCandidate } from "../strategy/research-description.js";
import { candle } from "./fixtures.js";

const ref = { type: "indicator" as const, indicator: "ema", parameters: { period: 14 }, timeframe: "1h" as const, output: "ema" };
const condition = { left: ref, operator: ">" as const, right: { type: "constant" as const, value: 100 } };
const fakeEngine = (value: number | (() => number), availability: "AVAILABLE" | "EXPECTED_WARMUP_MISSING" | "MISSING_REQUIRED_DATA" = "AVAILABLE") => ({
  value: typeof value === "function" ? value : () => value,
  previousValue: () => value,
  price: () => 100,
  referenceAvailability: () => availability,
}) as unknown as FeatureEngine;

const run = researchRunSchema.parse({ name: "Outcome test", symbol: "BTCUSDT", triggerTimeframe: "1h", executionTimeframe: "1h", period: { mode: "AUTOMATIC", policy: "BALANCED", start: "2025-01-01T00:00:00.000Z", end: "2025-04-01T00:00:00.000Z" }, allowedIndicators: ["ema"] });

describe("Research Run terminal outcomes and typed preflight", () => {
  it("maps normal, partial and exhausted generation to explicit terminal outcomes", () => {
    expect(resolveResearchTerminalOutcome(10, 10, false)).toBe("COMPLETED");
    expect(resolveResearchTerminalOutcome(4, 10, true)).toBe("PARTIAL");
    expect(resolveResearchTerminalOutcome(0, 10, true)).toBe("EXHAUSTED");
  });

  it("keeps evaluation failures typed instead of converting them to false", () => {
    const asOf = new Date("2025-01-01T00:00:00.000Z");
    expect(evaluateCondition(condition, fakeEngine(90), asOf).status).toBe("FALSE");
    expect(evaluateCondition(condition, fakeEngine(Number.NaN, "EXPECTED_WARMUP_MISSING"), asOf).status).toBe("EXPECTED_WARMUP_MISSING");
    expect(evaluateCondition(condition, fakeEngine(Number.NaN, "MISSING_REQUIRED_DATA"), asOf).status).toBe("MISSING_REQUIRED_DATA");
    expect(evaluateCondition(condition, fakeEngine(Number.NaN), asOf).status).toBe("NON_FINITE_VALUE");
    expect(evaluateCondition(condition, fakeEngine(() => { throw new Error("indicator failed"); }), asOf).status).toBe("FEATURE_CALCULATION_ERROR");
  });

  it("persists diagnostics in preflight results and rejects candidates with calculation errors", () => {
    const base = candidateConfig(run, 0).config;
    const config = strategyConfigSchema.parse({ ...base, longEntry: condition, shortEntry: { ...condition, operator: "<", right: { type: "constant", value: 100 } } });
    const candles = Array.from({ length: 4 }, (_, index) => candle(Date.UTC(2025, 0, 1, index), { timeframe: "1h" }));
    const engine = { candles: () => candles, value: () => { throw new Error("feature failed"); }, referenceAvailability: () => "AVAILABLE", previousValue: () => Number.NaN, price: () => 100 } as unknown as FeatureEngine;
    const result = preflightCandidate(config, engine, { start: candles[0]!.openTime, end: candles.at(-1)!.closeTime });
    expect(result.accepted).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("PREFLIGHT_EVALUATION_ERROR");
    expect(result.diagnostics.long[0]?.status).toBe("FEATURE_CALCULATION_ERROR");
  });

  it("formats the normalized AST deterministically and exposes unsupported parts", () => {
    const config = candidateConfig(run, 0).config;
    const normalized = { longEntry: config.longEntry, shortEntry: config.shortEntry };
    const first = describeCandidate(normalized, config);
    const second = describeCandidate(normalized, config);
    expect(first).toBe(second);
    expect(first).toContain("Long");
    expect(first).toContain("Risk");
  });
});
