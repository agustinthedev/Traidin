import { describe, expect, it } from "vitest";
import { aggregateCandles } from "../domain/aggregate.js";
import { alignCeil, bucketOpen } from "../domain/intervals.js";
import { validateCandle } from "../domain/validate.js";
import { candle } from "./fixtures.js";
describe("candle validation", () => {
  it("checks OHLC, time, volume and alignment", () => { const invalid = candle(Date.UTC(2026,0,1,0,0), { high: "99", low: "103", volume: "-1" }); expect(validateCandle(invalid).map((i) => i.code)).toEqual(expect.arrayContaining(["HIGH_BOUNDS","LOW_BOUNDS","OHLC_RANGE","NEGATIVE_VOLUME"])); });
  it("preserves decimal precision as strings", () => expect(candle(0).open).toBe("100.10000000"));
});
describe("UTC buckets", () => {
  it("aligns 4h and day to UTC", () => { expect(bucketOpen(new Date("2026-08-01T07:42:00Z"), "4h").toISOString()).toBe("2026-08-01T04:00:00.000Z"); expect(bucketOpen(new Date("2026-08-01T22:00:00Z"), "1d").toISOString()).toBe("2026-08-01T00:00:00.000Z"); });
  it("aligns week to Monday 00:00 UTC", () => expect(bucketOpen(new Date("2026-08-06T12:00:00Z"), "1w").toISOString()).toBe("2026-08-03T00:00:00.000Z"));
  it("ceil-aligns partial timestamps without creating zero-length gaps", () => { expect(alignCeil(new Date("2026-08-01T00:00:01Z"), "1m").toISOString()).toBe("2026-08-01T00:01:00.000Z"); expect(alignCeil(new Date("2026-08-01T00:01:00Z"), "1m").toISOString()).toBe("2026-08-01T00:01:00.000Z"); });
});
describe("aggregation", () => {
  it("aggregates exact OHLCV and trades", () => { const start = Date.UTC(2026,7,1,0,0); const input = Array.from({ length: 5 }, (_, i) => candle(start + i * 60_000, { open: String(100 + i), high: String(105 + i), low: String(98 - i), close: String(101 + i), volume: "0.1", quoteVolume: "1.25", tradeCount: i + 1, takerBuyBaseVolume: "0.01", takerBuyQuoteVolume: "0.125" })); const result = aggregateCandles(input, "5m"); expect(result.missingOpenTimes).toHaveLength(0); expect(result.candle).toMatchObject({ open: "100", high: "109", low: "94", close: "105", volume: "0.5", quoteVolume: "6.25", tradeCount: 15, isComplete: true }); });
  it("marks an aggregate incomplete when a minute is absent", () => { const start = Date.UTC(2026,7,1,0,0); const result = aggregateCandles([0,1,3,4].map((i) => candle(start + i * 60_000)), "5m"); expect(result.missingOpenTimes).toHaveLength(1); expect(result.candle.isComplete).toBe(false); });
});
