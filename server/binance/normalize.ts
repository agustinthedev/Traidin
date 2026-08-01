import type { Candle, CandleSource } from "../domain/candle.js";
import { EXCHANGE, MARKET } from "../domain/candle.js";
import { combinedKlineSchema, klinePayloadSchema } from "./schemas.js";
export function normalizeWsKline(input: unknown, receivedAt = new Date()): Candle {
  const outer = combinedKlineSchema.safeParse(input); const data = outer.success ? outer.data.data : klinePayloadSchema.parse(input);
  if (data.s !== data.k.s) throw new Error("Kline symbol mismatch");
  return { exchange: EXCHANGE, market: MARKET, symbol: data.k.s, timeframe: data.k.i, openTime: new Date(data.k.t), closeTime: new Date(data.k.T),
    open: data.k.o, high: data.k.h, low: data.k.l, close: data.k.c, volume: data.k.v, quoteVolume: data.k.q, tradeCount: data.k.n,
    takerBuyBaseVolume: data.k.V, takerBuyQuoteVolume: data.k.Q, firstTradeId: data.k.f, lastTradeId: data.k.L, isClosed: data.k.x,
    isComplete: data.k.x, source: "WEBSOCKET", eventTime: new Date(data.E), receivedAt };
}
export function normalizeRestKline(symbol: string, timeframe: string, row: unknown[], source: CandleSource, receivedAt = new Date()): Candle {
  if (row.length < 11) throw new Error("Invalid REST kline tuple");
  return { exchange: EXCHANGE, market: MARKET, symbol, timeframe, openTime: new Date(Number(row[0])), open: String(row[1]), high: String(row[2]), low: String(row[3]), close: String(row[4]), volume: String(row[5]), closeTime: new Date(Number(row[6])), quoteVolume: String(row[7]), tradeCount: Number(row[8]), takerBuyBaseVolume: String(row[9]), takerBuyQuoteVolume: String(row[10]), firstTradeId: null, lastTradeId: null, isClosed: true, isComplete: true, source, eventTime: null, receivedAt };
}
