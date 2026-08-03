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
  private activeGapId?: string;
  private liveFreshSince = 0;
  healthy = true;
  async start() {
    await gapRepository.recoverInterrupted();
    this.timer = setInterval(() => void this.runOnce(), 5_000);
    this.watchdogTimer = setInterval(() => void this.watchdog(), 15_000);
    void this.runOnce();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }
  private async watchdog() {
    // The worker can spend several minutes in a REST retry or aggregation pass
    // without writing a candle checkpoint. Never fail that active gap from a
    // concurrent watchdog tick; its own catch/finally path owns the terminal
    // state. Other abandoned repairs remain protected by the watchdog.
    const failed = await gapRepository.failStalled(
      config.GAP_REPAIR_STALL_TIMEOUT_MS,
      this.activeGapId,
    );
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
  private async deferForLiveStream(gapId: string) {
    await gapRepository.update(
      gapId,
      "DETECTED",
      "Deferred to protect the live WebSocket stream",
    );
  }
  private liveStreamHasPriority() {
    if (!liveState.websocketFresh()) {
      this.liveFreshSince = 0;
      return true;
    }
    if (!this.liveFreshSince) {
      this.liveFreshSince = Date.now();
      return true;
    }
    return Date.now() - this.liveFreshSince < 30_000;
  }
  async runOnce() {
    if (this.busy) return;
    if (jobRepository.hasActive()) return;
    if (this.liveStreamHasPriority()) return;
    this.busy = true;
    let gap: Awaited<ReturnType<typeof gapRepository.claimNext>> = null;
    try {
      gap = await gapRepository.claimNext();
      if (!gap) {
        this.healthy = true;
        return;
      }
      this.activeGapId = gap.id;
      await eventBus.emit({
        level: "REPAIR",
        component: "gap-repair",
        event: "GAP_REPAIR_STARTED",
        message: "Gap repair started",
        symbol: gap.symbol,
        timeframe: gap.timeframe,
        details: { gapId: gap.id },
      });
      const step = intervalMs(gap.timeframe);
      let cursor = gap.checkpointTime
          ? gap.checkpointTime.getTime() + step
          : gap.gapStart.getTime(),
        total = gap.persistedCandles,
        downloaded = gap.downloadedCandles,
        requests = gap.requestCount;
      while (cursor <= gap.gapEnd.getTime()) {
        if (!liveState.websocketFresh()) {
          await this.deferForLiveStream(gap.id);
          return;
        }
        if (jobRepository.hasActive()) {
          await gapRepository.update(
            gap.id,
            "DETECTED",
            "Deferred while a backfill job is active",
          );
          return;
        }
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
        let rowsAffected = 0;
        const commitSize = Math.min(config.SQLITE_BATCH_SIZE, 250);
        for (let offset = 0; offset < batch.length; offset += commitSize) {
          const write = await candleRepository.upsertMany(
            batch.slice(offset, offset + commitSize),
            2,
          );
          rowsAffected += write.rowsAffected;
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (!liveState.websocketFresh()) {
            await this.deferForLiveStream(gap.id);
            return;
          }
        }
        total += rowsAffected;
        const checkpoint = batch.at(-1)!.openTime;
        cursor = checkpoint.getTime() + step;
        await gapRepository.updateProgress(gap.id, {
          downloadedCandles: downloaded,
          persistedCandles: total,
          requestCount: requests,
          checkpointTime: checkpoint,
        });
      }
      await gapRepository.update(gap.id, "REPAIRED");
      if (gap.timeframe === "1m") {
        for (const timeframe of config.aggregatedTimeframes) {
          let bucket = bucketOpen(gap.gapStart, timeframe);
          const finalBucket = bucketOpen(gap.gapEnd, timeframe);
          let scannedBuckets = 0;
          while (bucket <= finalBucket) {
            if (!liveState.websocketFresh()) {
              await this.deferForLiveStream(gap.id);
              return;
            }
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
            if (++scannedBuckets % 100 === 0)
              await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
      }
      liveState.repairedGaps++;
      this.healthy = true;
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
      if (gap) await gapRepository.update(
        gap.id,
        "FAILED",
        error instanceof Error ? error.message : "Unknown error",
      );
      await eventBus.emit({
        level: "ERROR",
        component: "gap-repair",
        event: "GAP_REPAIR_FAILED",
        message: error instanceof Error ? error.message : "Repair failed",
        symbol: gap?.symbol,
        timeframe: gap?.timeframe,
      });
    } finally {
      this.activeGapId = undefined;
      this.busy = false;
    }
  }
}
export const gapRepairWorker = new GapRepairWorker();
