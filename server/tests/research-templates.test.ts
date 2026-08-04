import { describe, expect, it } from "vitest";
import { indicatorRegistry } from "../strategy/indicators.js";
import {
  buildTemplate,
  getResearchTemplate,
  validateTemplateCoverage,
} from "../strategy/research-templates.js";
import { generateCandidate } from "../strategy/research-generator.js";
import { researchRunSchema } from "../strategy/model.js";

describe("formal research templates", () => {
  it("has an implementation for every registry template", () =>
    expect(validateTemplateCoverage()).toBe(true));
  it("covers the formal indicator families", () => {
    const ids = new Set(
      Object.values(indicatorRegistry).flatMap(
        (definition) => definition.templates,
      ),
    );
    for (const id of [
      "RSI_MOMENTUM_THRESHOLD",
      "MACD_LINE_SIGNAL_CROSS",
      "ADX_TREND_STRENGTH_FILTER",
      "BOLLINGER_REENTRY",
      "RELATIVE_VOLUME_CONFIRMATION",
      "CALENDAR_MEMBERSHIP_FILTER",
    ])
      expect(ids.has(id)).toBe(true);
  });
  it("changes the candidate space when available templates change", () => {
    const input = researchRunSchema.parse({
      name: "Test",
      symbol: "BTCUSDT",
      triggerTimeframe: "1h",
      executionTimeframe: "5m",
      period: {
        mode: "AUTOMATIC",
        policy: "BALANCED",
        start: "2025-01-01",
        end: "2025-12-31",
      },
      randomSeed: 4,
      allowedIndicators: ["rsi"],
    });
    const original = indicatorRegistry.rsi.templates;
    const first = generateCandidate(input, 0).template;
    indicatorRegistry.rsi.templates = ["RSI_MEAN_REVERSION_CROSS"];
    const second = generateCandidate(input, 0).template;
    indicatorRegistry.rsi.templates = original;
    expect(original).toContain(first);
    expect(second).toBe("RSI_MEAN_REVERSION_CROSS");
  });
  it("builds a registered predicate and records its role", () => {
    const template = getResearchTemplate("RSI_MOMENTUM_THRESHOLD");
    const built = buildTemplate(
      "RSI_MOMENTUM_THRESHOLD",
      "rsi",
      "rsi",
      { period: 14 },
      "1h",
      () => 0.5,
    );
    expect(template.version).toBeTruthy();
    expect(built.role).toBe("DIRECTIONAL_TRIGGER");
    expect(built.long).toBeTruthy();
  });
});
