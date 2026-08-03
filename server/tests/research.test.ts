import { describe, expect, it } from "vitest";
import { researchRunSchema } from "../strategy/model.js";
import { normalizedCandidateHash } from "../strategy/research-normalization.js";
import { splitResearchPeriod } from "../strategy/research-worker.js";

const run = (overrides: Record<string, unknown> = {}) => researchRunSchema.parse({ name: "Research", symbol: "BTCUSDT", triggerTimeframe: "1h", executionTimeframe: "1m", period: { mode: "AUTOMATIC", policy: "BALANCED", start: "2025-01-01T00:00:00.000Z", end: "2025-11-01T00:00:00.000Z" }, ...overrides });

describe("Strategy Lab domain", () => {
  it("creates deterministic, chronological automatic splits", () => { const split = splitResearchPeriod(run()); expect(split.is.start < split.is.end).toBe(true); expect(split.is.end).toEqual(split.oos.start); expect(split.oos.end).toEqual(split.holdout.start); expect(split.holdout.end).toEqual(new Date("2025-11-01T00:00:00.000Z")); });
  it("rejects incomplete or overlapping manual splits", () => { expect(() => splitResearchPeriod(run({ period: { mode: "MANUAL", start: "2025-01-01T00:00:00.000Z", end: "2025-11-01T00:00:00.000Z", isStart: "2025-01-01T00:00:00.000Z", isEnd: "2025-05-01T00:00:00.000Z", oosStart: "2025-04-01T00:00:00.000Z", oosEnd: "2025-08-01T00:00:00.000Z", holdoutStart: "2025-08-01T00:00:00.000Z", holdoutEnd: "2025-11-01T00:00:00.000Z" } }))).toThrow(/chronological/); });
  it("deduplicates equivalent AND order and comparison direction", () => { const a = { longEntry: { type: "group", operator: "AND", children: [{ left: { type: "constant", value: 1 }, operator: ">", right: { type: "constant", value: 0 } }, { left: { type: "constant", value: 2 }, operator: ">", right: { type: "constant", value: 1 } }] } }; const b = { longEntry: { type: "group", operator: "AND", children: [{ left: { type: "constant", value: 1 }, operator: "<", right: { type: "constant", value: 2 } }, { left: { type: "constant", value: 0 }, operator: "<", right: { type: "constant", value: 1 } }] } }; expect(normalizedCandidateHash(a).hash).toBe(normalizedCandidateHash(b).hash); });
});
