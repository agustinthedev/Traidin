import { describe, expect, it } from "vitest";
import { BinanceAdapter } from "../binance/adapter.js";
import { normalizeWsKline } from "../binance/normalize.js";
describe("real public Binance integration", () => {
  it("fetches real USD-M klines without credentials", async () => { const adapter = new BinanceAdapter(); await adapter.ping(); const rows = await adapter.fetchKlines("BTCUSDT", "1m", undefined, undefined, 2); expect(rows).toHaveLength(2); expect(rows[0]).toMatchObject({ symbol: "BTCUSDT", timeframe: "1m", source: "REST_BACKFILL" }); expect(adapter.serverTimeOffsetMs).not.toBeNaN(); });
  it("receives and validates a real kline WebSocket frame", async () => { const payload = await new Promise<unknown>((resolve, reject) => { const ws = new WebSocket("wss://fstream.binance.com/market/ws/btcusdt@kline_1m"); const timer = setTimeout(() => { ws.close(); reject(new Error("WebSocket frame timeout")); }, 20_000); ws.addEventListener("message", (event) => { clearTimeout(timer); ws.close(); resolve(JSON.parse(String(event.data))); }); ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket connection failed")); }); }); const candle = normalizeWsKline(payload); expect(candle).toMatchObject({ symbol: "BTCUSDT", timeframe: "1m", source: "WEBSOCKET" }); });
});
