import { describe, expect, it } from "vitest";
import { normalizeRestKline, normalizeWsKline } from "../binance/normalize.js";
const payload = { stream: "btcusdt@kline_1m", data: { e: "kline", E: 1_700_000_060_100, s: "BTCUSDT", k: { t: 1_700_000_040_000, T: 1_700_000_099_999, s: "BTCUSDT", i: "1m", f: 100, L: 200, o: "10.1", c: "10.2", h: "10.3", l: "10.0", v: "5.5", n: 101, x: true, q: "56.1", V: "3.2", Q: "32.8", B: "0" } } };
describe("Binance normalization", () => {
  it("retains all useful WebSocket fields and detects closure", () => { const result = normalizeWsKline(payload); expect(result).toMatchObject({ symbol: "BTCUSDT", timeframe: "1m", firstTradeId: 100, lastTradeId: 200, tradeCount: 101, quoteVolume: "56.1", takerBuyBaseVolume: "3.2", takerBuyQuoteVolume: "32.8", isClosed: true, source: "WEBSOCKET" }); });
  it("rejects symbol mismatches", () => expect(() => normalizeWsKline({ ...payload, data: { ...payload.data, s: "ETHUSDT" } })).toThrow("symbol mismatch"));
  it("normalizes REST tuples without binary conversion", () => { const result = normalizeRestKline("BTCUSDT", "1m", [1000,"1.00000001","2","0.5","1.5","3",60999,"4",5,"1.25","2.5","0"], "REST_BACKFILL"); expect(result.open).toBe("1.00000001"); expect(result.eventTime).toBeNull(); });
  it("rejects malformed tuples", () => expect(() => normalizeRestKline("BTCUSDT", "1m", [], "REST_BACKFILL")).toThrow());
});
