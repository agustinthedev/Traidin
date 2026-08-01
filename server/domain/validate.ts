import Decimal from "decimal.js";
import type { Candle } from "./candle.js";
import { bucketOpen, intervalMs } from "./intervals.js";
export interface ValidationIssue { code: string; message: string }
export function validateCandle(c: Candle): ValidationIssue[] {
  const issues: ValidationIssue[] = []; let o: Decimal, h: Decimal, l: Decimal, close: Decimal, volume: Decimal;
  try { o = new Decimal(c.open); h = new Decimal(c.high); l = new Decimal(c.low); close = new Decimal(c.close); volume = new Decimal(c.volume); } catch { return [{ code: "INVALID_DECIMAL", message: "Financial field is not decimal" }]; }
  if (h.lt(o) || h.lt(close)) issues.push({ code: "HIGH_BOUNDS", message: "High is below open or close" });
  if (l.gt(o) || l.gt(close)) issues.push({ code: "LOW_BOUNDS", message: "Low is above open or close" });
  if (h.lt(l)) issues.push({ code: "OHLC_RANGE", message: "High is below low" });
  if (volume.lt(0) || new Decimal(c.quoteVolume).lt(0) || new Decimal(c.takerBuyBaseVolume).lt(0) || new Decimal(c.takerBuyQuoteVolume).lt(0)) issues.push({ code: "NEGATIVE_VOLUME", message: "Volume cannot be negative" });
  if (c.openTime >= c.closeTime) issues.push({ code: "TIME_ORDER", message: "Open time must precede close time" });
  try { intervalMs(c.timeframe); if (bucketOpen(c.openTime, c.timeframe).getTime() !== c.openTime.getTime()) issues.push({ code: "MISALIGNED", message: "Open time is not aligned" }); } catch { issues.push({ code: "TIMEFRAME", message: "Unsupported timeframe" }); }
  if (!/^[A-Z0-9_]+$/.test(c.symbol)) issues.push({ code: "SYMBOL", message: "Invalid symbol" });
  return issues;
}
