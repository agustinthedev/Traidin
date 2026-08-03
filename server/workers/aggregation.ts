import type { Candle } from "../domain/candle.js";
import { aggregateCandles } from "../domain/aggregate.js";
import { bucketOpen, intervalMs } from "../domain/intervals.js";
import { candleRepository, jobRepository } from "../db/repository.js";
import { config } from "../config.js";
import { eventBus } from "../events/bus.js";
import { gapService } from "../services/gap-service.js";
import { liveState } from "../live-state.js";

export class AggregationEngine {
  private reconciliationTimer?: NodeJS.Timeout;
  private qualityScanInFlight = false;
  private reconciling = false;
  healthy = true;
  start() {
    if (this.reconciliationTimer) return;
    this.reconciliationTimer = setInterval(
      () => {
        if (liveState.websocketFresh())
          void this.reconcileIncomplete(10, true).catch(() => {});
      },
      config.DATA_QUALITY_SCAN_INTERVAL_MS,
    );
    void this.scanDataQuality();
  }
  stop() {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
  }
  private async scanDataQuality() {
    if (this.qualityScanInFlight || !liveState.websocketFresh() || jobRepository.hasActive()) return;
    this.qualityScanInFlight = true;
    try {
      const result = await gapService.scanAll();
      await eventBus.emit({
        level: "INFO",
        component: "gap-detector",
        event: "GAP_SCAN_COMPLETED",
        message: `Automatic data-quality scan completed: ${result.ranges} gap range(s) found`,
        rowsAffected: result.ranges,
        details: { automatic: true, frames: result.frames },
      });
    } catch (error) {
      this.healthy = false;
      await eventBus.emit({
        level: "ERROR",
        component: "gap-detector",
        event: "GAP_SCAN_FAILED",
        message: error instanceof Error ? error.message : "Automatic data-quality scan failed",
        errorCode: "GAP_SCAN_FAILED",
      });
    } finally {
      this.qualityScanInFlight = false;
    }
  }
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
  async reconcileIncomplete(limit = 250, protectLive = false) {
    if (this.reconciling) return 0;
    if (jobRepository.hasActive()) return 0;
    this.reconciling = true;
    let rebuilt = 0;
    try {
      let scanned = 0;
      for (const candidate of candleRepository.incompleteAggregates(limit)) {
        if (protectLive && !liveState.websocketFresh()) break;
        const expectedMinutes = intervalMs(candidate.timeframe) / 60_000;
        const end = new Date(
          candidate.openTime.getTime() +
            intervalMs(candidate.timeframe) -
            60_000,
        );
        const minutes = candleRepository.range(
          candidate.symbol,
          "1m",
          candidate.openTime,
          end,
          expectedMinutes,
        );
        if (
          minutes.length !== expectedMinutes ||
          minutes.some((minute) => !minute.isClosed || !minute.isComplete)
        )
          continue;
        const result = await this.buildBucket(
          candidate.symbol,
          candidate.timeframe,
          candidate.openTime,
        );
        if (result?.candle.isComplete) rebuilt++;
        if (++scanned % 5 === 0)
          await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.healthy = true;
      if (rebuilt)
        await eventBus.emit({
          level: "AGG",
          component: "aggregation",
          event: "AGGREGATION_RECONCILED",
          message: `${rebuilt} incomplete aggregation(s) reconciled`,
          rowsAffected: rebuilt,
        });
      return rebuilt;
    } catch (error) {
      this.healthy = false;
      await eventBus.emit({
        level: "ERROR",
        component: "aggregation",
        event: "AGGREGATION_RECONCILIATION_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Aggregation reconciliation failed",
        errorCode: "AGGREGATION_RECONCILIATION_FAILED",
      });
      throw error;
    } finally {
      this.reconciling = false;
    }
  }
  async rebuild(symbol: string, timeframe: string, start: Date, end: Date) {
    if (!liveState.websocketFresh()) return 0;
    const batchSize = Math.min(config.SQLITE_BATCH_SIZE, 250);
    const pending: Candle[] = [];
    let cursor = bucketOpen(start, timeframe),
      completed = 0,
      incomplete = 0,
      rowsAffected = 0;
    while (cursor <= end) {
      if (!liveState.websocketFresh()) break;
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
    if (pending.length) {
      rowsAffected += (await candleRepository.upsertMany(pending, 6))
        .rowsAffected;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
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
