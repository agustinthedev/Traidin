import { binance } from "../binance/adapter.js";
import { candleRepository, gapRepository, jobRepository } from "../db/repository.js";
import { eventBus } from "../events/bus.js";
import { liveState } from "../live-state.js";
import { config } from "../config.js";
import { bucketOpen, intervalMs } from "../domain/intervals.js";
import { aggregationEngine } from "./aggregation.js";
export class GapRepairWorker {
  private timer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private busy = false;
  healthy = true;
  async start() {
    await gapRepository.recoverInterrupted();
    this.timer = setInterval(() => void this.runOnce(), 1000);
    this.watchdogTimer = setInterval(() => void this.watchdog(), 15_000);
    void this.runOnce();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }
  private async watchdog() {
    const failed = await gapRepository.failStalled(120_000);
    if (!failed) return;
    this.healthy = false;
    await eventBus.emit({
      level: "ERROR",
      component: "gap-repair",
      event: "GAP_REPAIR_STALLED",
      message: `${failed} gap repair(s) stopped after no checkpoint progress`,
      errorCode: "GAP_REPAIR_STALLED",
    });
  }
  async runOnce() {
    if (this.busy) return;
    if (jobRepository.hasActive()) return;
    const gap = await gapRepository.claimNext();
    if (!gap) return;
    this.busy = true;
    await eventBus.emit({
      level: "REPAIR",
      component: "gap-repair",
      event: "GAP_REPAIR_STARTED",
      message: "Gap repair started",
      symbol: gap.symbol,
      timeframe: gap.timeframe,
      details: { gapId: gap.id },
    });
    try {
      const step = intervalMs(gap.timeframe);
      let cursor = gap.checkpointTime
          ? gap.checkpointTime.getTime() + step
          : gap.gapStart.getTime(),
        total = gap.persistedCandles,
        downloaded = gap.downloadedCandles,
        requests = gap.requestCount;
      while (cursor <= gap.gapEnd.getTime()) {
        const end = Math.min(gap.gapEnd.getTime(), cursor + 1499 * step);
        const batch = await binance.fetchKlines(
          gap.symbol,
          gap.timeframe,
          cursor,
          end,
          1500,
          "REST_GAP_REPAIR",
        );
        requests++;
        downloaded += batch.length;
        if (!batch.length) break;
        const write = await candleRepository.upsertMany(batch, 2);
        total += write.rowsAffected;
        const checkpoint = batch.at(-1)!.openTime;
        cursor = checkpoint.getTime() + step;
        await gapRepository.updateProgress(gap.id, {
          downloadedCandles: downloaded,
          persistedCandles: total,
          requestCount: requests,
          checkpointTime: checkpoint,
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await gapRepository.update(gap.id, "REPAIRED");
      if (gap.timeframe === "1m") {
        for (const timeframe of config.aggregatedTimeframes) {
          let bucket = bucketOpen(gap.gapStart, timeframe);
          const finalBucket = bucketOpen(gap.gapEnd, timeframe);
          while (bucket <= finalBucket) {
            const existing = candleRepository.range(
              gap.symbol,
              timeframe,
              bucket,
              bucket,
              1,
            )[0];
            if (existing && !existing.isComplete)
              await aggregationEngine.buildBucket(
                gap.symbol,
                timeframe,
                bucket,
              );
            bucket = new Date(bucket.getTime() + intervalMs(timeframe));
          }
        }
      }
      liveState.repairedGaps++;
      await eventBus.emit({
        level: "REPAIR",
        component: "gap-repair",
        event: "GAP_REPAIRED",
        message: `Gap repaired: ${total} candles`,
        symbol: gap.symbol,
        timeframe: gap.timeframe,
        rowsAffected: total,
      });
    } catch (error) {
      this.healthy = false;
      await gapRepository.update(
        gap.id,
        "FAILED",
        error instanceof Error ? error.message : "Unknown error",
      );
      await eventBus.emit({
        level: "ERROR",
        component: "gap-repair",
        event: "GAP_REPAIR_FAILED",
        message: error instanceof Error ? error.message : "Repair failed",
        symbol: gap.symbol,
        timeframe: gap.timeframe,
      });
    } finally {
      this.busy = false;
    }
  }
}
export const gapRepairWorker = new GapRepairWorker();
