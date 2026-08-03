import { describe, expect, it } from "vitest";
import { indicatorRegistry, indicatorOutputSemantics, validateIndicator, validateIndicatorRegistry } from "../strategy/indicators.js";
import { researchRunSchema, strategyConfigSchema, stageQuality } from "../strategy/model.js";
import { candidateConfig } from "../strategy/research-worker.js";
import { complexityOf, normalizedCandidateHash } from "../strategy/research-normalization.js";
import { validateCandidateSemantics } from "../strategy/research-grammar.js";

const run = (overrides: Record<string, unknown> = {}) => researchRunSchema.parse({ name: "Semantic Research", symbol: "BTCUSDT", triggerTimeframe: "1h", executionTimeframe: "5m", period: { mode: "AUTOMATIC", policy: "BALANCED", start: "2024-01-01T00:00:00.000Z", end: "2025-01-01T00:00:00.000Z" }, ...overrides });

describe("semantic discovery grammar", () => {
  it("requires complete typed metadata for every registered output", () => {
    expect(validateIndicatorRegistry()).toEqual([]);
    expect(Object.keys(indicatorRegistry).length).toBeGreaterThan(80);
    expect(indicatorOutputSemantics("supertrend", "direction").semanticType).toBe("CATEGORICAL_DIRECTION");
  });
  it("enforces indicator-specific structural ranges", () => {
    expect(() => validateIndicator("macd", { fast: 500, slow: 3, signal: 9 })).toThrow();
    expect(() => validateIndicator("macd", { fast: 30, slow: 20, signal: 9 })).toThrow(/fast period/);
    expect(() => validateIndicator("bollinger", { period: 20, deviations: .1 })).toThrow(/deviations/);
    expect(() => validateIndicator("supertrend", { period: 500, multiple: .1 })).toThrow();
  });
  it("rejects non-negative sign pairs and categorical price comparisons", () => {
    const generated = candidateConfig(run({ allowedIndicators: ["ema"] }), 0).config;
    const invalid = strategyConfigSchema.parse({ ...generated, longEntry: { left: { type: "indicator", indicator: "atr", parameters: { period: 14 }, timeframe: "1h", output: "atr" }, operator: ">", right: { type: "constant", value: 0 } }, shortEntry: { left: { type: "indicator", indicator: "atr", parameters: { period: 14 }, timeframe: "1h", output: "atr" }, operator: "<", right: { type: "constant", value: 0 } } });
    expect(validateCandidateSemantics(invalid).errors).toEqual(expect.arrayContaining([expect.stringContaining("non-negative")]));
    const invalidSupertrend = strategyConfigSchema.parse({ ...generated, longEntry: { left: { type: "price", field: "close", timeframe: "1h" }, operator: "crosses_above", right: { type: "indicator", indicator: "supertrend", parameters: { period: 10, multiple: 3 }, timeframe: "1h", output: "direction" } } });
    expect(validateCandidateSemantics(invalidSupertrend).errors).toEqual(expect.arrayContaining([expect.stringContaining("Categorical outputs")]));
  });
  it("rejects bounded non-negative MFI and raw cumulative OBV sign pairs", () => {
    const generated = candidateConfig(run({ allowedIndicators: ["ema"] }), 0).config;
    for (const [indicator, output, parameters] of [["money_flow_index", "mfi", { period: 14 }], ["obv", "obv", {}]] as const) {
      const invalid = strategyConfigSchema.parse({ ...generated, longEntry: { left: { type: "indicator", indicator, parameters, timeframe: "1h", output }, operator: ">", right: { type: "constant", value: 0 } }, shortEntry: { left: { type: "indicator", indicator, parameters, timeframe: "1h", output }, operator: "<", right: { type: "constant", value: 0 } } });
      expect(validateCandidateSemantics(invalid).errors).toEqual(expect.arrayContaining([expect.stringContaining("cannot be used as > 0 long and < 0 short")]));
    }
    expect(indicatorOutputSemantics("money_flow_index", "mfi").canBeNegative).toBe(false);
  });
  it("generates deterministic multi-condition candidates with meaningful complexity", () => {
    const input = run({ allowedIndicators: ["ema", "rsi", "relative_volume"] });
    const first = candidateConfig(input, 1), second = candidateConfig(input, 1);
    expect(normalizedCandidateHash(first.rawAst).hash).toBe(normalizedCandidateHash(second.rawAst).hash);
    expect(complexityOf(first.rawAst)).toBeGreaterThan(2);
  });
  it("resolves stage gates independently while retaining legacy defaults", () => {
    const input = run({ minTrades: 12, minProfitFactor: 1.2, maxDrawdownPct: 25, qualityGates: { oos: { minTrades: 30, minProfitFactor: 1.35, maxDrawdownPct: 15 } } });
    expect(stageQuality(input, "is")).toEqual({ minTrades: 12, minProfitFactor: 1.2, maxDrawdownPct: 25 });
    expect(stageQuality(input, "oos")).toEqual({ minTrades: 30, minProfitFactor: 1.35, maxDrawdownPct: 15 });
  });
});
