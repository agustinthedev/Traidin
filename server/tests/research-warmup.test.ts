import { describe, expect, it } from "vitest";
import { dataFingerprint } from "../strategy/verification-worker.js";
import { requiredResearchWarmup } from "../strategy/research-worker.js";
import { researchRunSchema } from "../strategy/model.js";

const input = (allowedIndicators: string[]) =>
  researchRunSchema.parse({
    name: "Warmup audit",
    symbol: "BTCUSDT",
    triggerTimeframe: "1h",
    executionTimeframe: "5m",
    period: {
      mode: "AUTOMATIC",
      policy: "BALANCED",
      start: "2024-01-15",
      end: "2025-12-31",
    },
    allowedIndicators,
  });
describe("discovery warmup provenance", () => {
  it("derives non-zero warmup from selected indicator templates", () =>
    expect(requiredResearchWarmup(input(["macd", "rsi"]))).toMatchObject({
      "1h": expect.any(Number),
      "5m": 1,
    }));
  it("changes the fingerprint when warmup context changes", () => {
    const start = new Date("2024-01-15"),
      end = new Date("2025-12-31");
    const complete = dataFingerprint("BTCUSDT", ["1h"], start, end, {
      "1h": 35,
    });
    const different = dataFingerprint("BTCUSDT", ["1h"], start, end, {
      "1h": 5,
    });
    expect(complete.checksum).not.toBe(different.checksum);
    expect(complete.warmup[0]?.bars).toBe(35);
  });
});
