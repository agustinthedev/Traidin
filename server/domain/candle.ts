export const MARKET = "BINANCE_USDM_FUTURES" as const;
export const EXCHANGE = "BINANCE" as const;
export type CandleSource = "WEBSOCKET" | "REST_BACKFILL" | "REST_GAP_REPAIR" | "LOCAL_AGGREGATION";
export interface Candle {
  exchange: typeof EXCHANGE; market: typeof MARKET; symbol: string; timeframe: string;
  openTime: Date; closeTime: Date; open: string; high: string; low: string; close: string;
  volume: string; quoteVolume: string; tradeCount: number; takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string; firstTradeId: number | null; lastTradeId: number | null;
  isClosed: boolean; isComplete: boolean; source: CandleSource; eventTime: Date | null; receivedAt: Date;
}
