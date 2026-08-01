import { config } from "../config.js";
import { eventBus } from "../events/bus.js";
import { restErrors } from "../observability.js";
import { normalizeRestKline } from "./normalize.js";
import type { CandleSource } from "../domain/candle.js";

export class BinanceHttpError extends Error { constructor(public status: number, public code: number | undefined, message: string, public retryAfter?: number) { super(message); } }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export class BinanceAdapter {
  usedWeight: Record<string, string> = {};
  serverTimeOffsetMs = 0;
  constructor(private restUrl = config.BINANCE_REST_URL) {}
  private async request<T>(path: string, params: Record<string, string | number | undefined> = {}, retries = 4): Promise<T> {
    const url = new URL(path, this.restUrl); for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, String(value));
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        for (const [key, value] of response.headers) if (key.startsWith("x-mbx-used-weight")) this.usedWeight[key] = value;
        if (!response.ok) { const body = await response.json().catch(() => ({})) as { code?: number; msg?: string }; const retryAfter = Number(response.headers.get("retry-after") ?? 0); throw new BinanceHttpError(response.status, body.code, body.msg ?? `Binance HTTP ${response.status}`, retryAfter); }
        return await response.json() as T;
      } catch (error) {
        restErrors.inc(); const retryable = !(error instanceof BinanceHttpError) || error.status === 429 || error.status >= 500;
        if (!retryable || attempt >= retries) throw error;
        const wait = error instanceof BinanceHttpError && error.retryAfter ? error.retryAfter * 1000 : Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 350;
        await eventBus.emit({ level: "WARN", component: "binance-rest", event: "REST_RETRY", message: `Retrying public Binance request (attempt ${attempt + 1})`, durationMs: Math.round(wait), errorCode: error instanceof BinanceHttpError ? String(error.code ?? error.status) : "NETWORK" });
        await sleep(wait);
      } finally { clearTimeout(timer); }
    }
  }
  async ping() { const before = Date.now(); const result = await this.request<{ serverTime: number }>("/fapi/v1/time"); const after = Date.now(); this.serverTimeOffsetMs = result.serverTime - Math.round((before + after) / 2); return result; }
  nowMs() { return Date.now() + this.serverTimeOffsetMs; }
  exchangeInfo() { return this.request<BinanceExchangeInfo>("/fapi/v1/exchangeInfo"); }
  async fetchKlines(symbol: string, interval: string, startTime?: number, endTime?: number, limit = 1500, source: CandleSource = "REST_BACKFILL") { const rows = await this.request<unknown[][]>("/fapi/v1/klines", { symbol, interval, startTime, endTime, limit }); const receivedAt = new Date(); return rows.map((row) => normalizeRestKline(symbol, interval, row, source, receivedAt)); }
}
export interface BinanceExchangeInfo { timezone: string; serverTime: number; rateLimits: unknown[]; symbols: Array<{ symbol: string; status: string; contractType: string; baseAsset: string; quoteAsset: string; marginAsset: string; pricePrecision: number; quantityPrecision: number; filters: Array<Record<string, string>> }> }
export const binance = new BinanceAdapter();
