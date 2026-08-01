import { candleRepository, gapRepository } from "../db/repository.js";
import { alignCeil, bucketOpen, intervalMs } from "../domain/intervals.js";
import { eventBus } from "../events/bus.js";
export class GapService {
  async scan(symbol: string, timeframe: string, start: Date, end: Date) { const alignedStart = alignCeil(start, timeframe); const alignedEnd = bucketOpen(end, timeframe); if (alignedStart > alignedEnd) return []; const ranges = candleRepository.missingRanges(symbol, timeframe, alignedStart, alignedEnd, intervalMs(timeframe)).filter((gap) => gap.count > 0 && gap.start <= gap.end); const created = await gapRepository.createMany(ranges.map((gap) => ({ symbol, timeframe, gapStart: gap.start, gapEnd: gap.end, expectedCandles: gap.count }))); if (created) await eventBus.emit({ level: "REPAIR", component: "gap-detector", event: "GAP_DETECTED", message: `${created} missing range(s) detected`, symbol, timeframe, details: ranges }); return ranges; }
}
export const gapService = new GapService();
