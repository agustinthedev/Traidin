import type { Candle } from "../domain/candle.js";
import { aggregateCandles } from "../domain/aggregate.js";
import { bucketOpen, intervalMs } from "../domain/intervals.js";
import { candleRepository } from "../db/repository.js";
import { config } from "../config.js";
import { eventBus } from "../events/bus.js";
import { gapService } from "../services/gap-service.js";
import { liveState } from "../live-state.js";

export class AggregationEngine {
  healthy = true;
  async onMinuteClosed(minute: Candle) {
    for (const timeframe of config.aggregatedTimeframes) {
      const bucket = bucketOpen(minute.openTime, timeframe);
      const endExclusive = bucket.getTime() + intervalMs(timeframe);
      if (minute.openTime.getTime() + 60_000 !== endExclusive) continue;
      await this.buildBucket(minute.symbol, timeframe, bucket);
    }
  }
  async buildBucket(symbol: string, timeframe: string, openTime: Date) {
    const count = intervalMs(timeframe) / 60_000;
    const end = new Date(openTime.getTime() + intervalMs(timeframe) - 60_000);
    const minutes = candleRepository.range(symbol, "1m", openTime, end, count);
    if (!minutes.length) return null;
    const result = aggregateCandles(minutes, timeframe);
    if (result.missingOpenTimes.length)
      await gapService.scan(symbol, "1m", openTime, end);
    const write = await candleRepository.upsertMany([result.candle], 6);
    liveState.aggregated++;
    await eventBus.emit({
      level: "AGG",
      component: "aggregation",
      event: result.candle.isComplete
        ? "AGGREGATED_CANDLE_CLOSED"
        : "AGGREGATED_CANDLE_INCOMPLETE",
      message: `${symbol} ${timeframe} aggregation ${result.candle.isComplete ? "closed" : "incomplete"}`,
      symbol,
      timeframe,
      durationMs: Math.round(write.durationMs),
      rowsAffected: write.rowsAffected,
      details: result.missingOpenTimes.length
        ? { missing: result.missingOpenTimes.length }
        : undefined,
    });
    return result;
  }
  async rebuild(symbol: string, timeframe: string, start: Date, end: Date) {
    const batchSize = 500;
    const pending: Candle[] = [];
    let cursor = bucketOpen(start, timeframe),
      completed = 0,
      incomplete = 0,
      rowsAffected = 0;
    while (cursor <= end) {
      const bucketEnd = new Date(
        cursor.getTime() + intervalMs(timeframe) - 60_000,
      );
      const minutes = candleRepository.range(
        symbol,
        "1m",
        cursor,
        bucketEnd,
        intervalMs(timeframe) / 60_000,
      );
      if (minutes.length) {
        const result = aggregateCandles(minutes, timeframe);
        pending.push(result.candle);
        completed++;
        if (result.missingOpenTimes.length) {
          incomplete++;
          await gapService.scan(symbol, "1m", cursor, bucketEnd);
        }
      }
      if (pending.length >= batchSize) {
        rowsAffected += (
          await candleRepository.upsertMany(pending.splice(0), 6)
        ).rowsAffected;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      cursor = new Date(cursor.getTime() + intervalMs(timeframe));
    }
    if (pending.length)
      rowsAffected += (await candleRepository.upsertMany(pending, 6))
        .rowsAffected;
    liveState.aggregated += completed;
    await eventBus.emit({
      level: "AGG",
      component: "aggregation",
      event: "AGGREGATION_REBUILD_COMPLETED",
      message: `${symbol} ${timeframe}: ${completed} buckets rebuilt`,
      symbol,
      timeframe,
      rowsAffected,
      details: { completed, incomplete, batchSize },
    });
    return completed;
  }
}
export const aggregationEngine = new AggregationEngine();
