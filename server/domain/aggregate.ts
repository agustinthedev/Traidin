import Decimal from "decimal.js";
import type { Candle } from "./candle.js";
import { EXCHANGE, MARKET } from "./candle.js";
import { bucketOpen, expectedClose, intervalMs } from "./intervals.js";

export interface AggregationResult { candle: Candle; missingOpenTimes: Date[] }
export function aggregateCandles(minutes: Candle[], timeframe: string, receivedAt = new Date()): AggregationResult {
  if (!minutes.length) throw new Error("Cannot aggregate an empty candle set");
  const sorted = [...minutes].sort((a, b) => a.openTime.getTime() - b.openTime.getTime()); const openTime = bucketOpen(sorted[0].openTime, timeframe); const count = intervalMs(timeframe) / 60_000;
  const byTime = new Map(sorted.filter((c) => c.timeframe === "1m" && c.isClosed && c.isComplete).map((c) => [c.openTime.getTime(), c])); const missingOpenTimes: Date[] = [];
  for (let i = 0; i < count; i++) if (!byTime.has(openTime.getTime() + i * 60_000)) missingOpenTimes.push(new Date(openTime.getTime() + i * 60_000));
  const available = [...byTime.values()].filter((c) => c.openTime >= openTime && c.openTime.getTime() < openTime.getTime() + intervalMs(timeframe)).sort((a, b) => a.openTime.getTime() - b.openTime.getTime()); if (!available.length) throw new Error("No aligned one-minute candles available");
  const sum = (field: "volume" | "quoteVolume" | "takerBuyBaseVolume" | "takerBuyQuoteVolume") => available.reduce((total, c) => total.plus(c[field]), new Decimal(0)).toFixed();
  const complete = missingOpenTimes.length === 0;
  return { missingOpenTimes, candle: { exchange: EXCHANGE, market: MARKET, symbol: available[0].symbol, timeframe, openTime, closeTime: expectedClose(openTime, timeframe), open: available[0].open, high: Decimal.max(...available.map((c) => new Decimal(c.high))).toFixed(), low: Decimal.min(...available.map((c) => new Decimal(c.low))).toFixed(), close: available.at(-1)!.close, volume: sum("volume"), quoteVolume: sum("quoteVolume"), tradeCount: available.reduce((n, c) => n + c.tradeCount, 0), takerBuyBaseVolume: sum("takerBuyBaseVolume"), takerBuyQuoteVolume: sum("takerBuyQuoteVolume"), firstTradeId: available[0].firstTradeId, lastTradeId: available.at(-1)!.lastTradeId, isClosed: true, isComplete: complete, source: "LOCAL_AGGREGATION", eventTime: null, receivedAt } };
}
