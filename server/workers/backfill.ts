import { config } from "../config.js";
import { binance } from "../binance/adapter.js";
import { candleRepository, jobRepository } from "../db/repository.js";
import { alignCeil, bucketOpen, intervalMs } from "../domain/intervals.js";
import { eventBus } from "../events/bus.js";
import { gapService } from "../services/gap-service.js";
import { aggregationEngine } from "./aggregation.js";

export class BackfillWorker {
  private timer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private busy = false;
  healthy = true;
  async create(input: {
    symbol: string;
    timeframe: string;
    startTime: Date;
    endTime?: Date;
    untilNow: boolean;
  }) {
    if (!config.symbols.includes(input.symbol))
      throw new Error("Symbol is not enabled");
    const end = input.endTime ?? new Date();
    const startAligned = alignCeil(input.startTime, input.timeframe),
      endAligned = bucketOpen(end, input.timeframe);
    const estimatedCandles =
      startAligned <= endAligned
        ? Math.floor(
            (endAligned.getTime() - startAligned.getTime()) /
              intervalMs(input.timeframe),
          ) + 1
        : 0;
    const job = await jobRepository.create({ ...input, estimatedCandles });
    await eventBus.emit({
      level: "INFO",
      component: "backfill",
      event: "BACKFILL_CREATED",
      message: `Backfill queued for ${input.symbol}`,
      symbol: input.symbol,
      timeframe: input.timeframe,
      jobId: job.id,
    });
    return job;
  }
  async start() {
    await jobRepository.recoverInterrupted();
    this.timer = setInterval(() => void this.runOnce(), 750);
    this.watchdogTimer = setInterval(() => void this.watchdog(), 15_000);
    void this.runOnce();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }
  private async watchdog() {
    const failed = await jobRepository.failStalled(120_000);
    if (!failed) return;
    this.healthy = false;
    await eventBus.emit({
      level: "ERROR",
      component: "backfill",
      event: "BACKFILL_STALLED",
      message: `${failed} backfill job(s) stopped after no checkpoint progress`,
      errorCode: "BACKFILL_STALLED",
    });
  }
  async runOnce() {
    if (this.busy) return;
    const job = await jobRepository.claimNext();
    if (!job) return;
    this.busy = true;
    try {
      await this.process(job);
    } finally {
      this.busy = false;
    }
  }
  private async process(
    initial: NonNullable<Awaited<ReturnType<typeof jobRepository.claimNext>>>,
  ) {
    const step = intervalMs(initial.timeframe);
    let cursor = initial.checkpointTime
      ? initial.checkpointTime.getTime() + step
      : alignCeil(initial.startTime, initial.timeframe).getTime();
    let downloaded = initial.downloadedCandles,
      persisted = initial.persistedCandles,
      requests = initial.requestCount;
    const target = initial.endTime
      ? bucketOpen(initial.endTime, initial.timeframe).getTime()
      : Math.floor(binance.nowMs() / step) * step - step;
    await eventBus.emit({
      level: "INFO",
      component: "backfill",
      event: "BACKFILL_STARTED",
      message: `Backfill started`,
      symbol: initial.symbol,
      timeframe: initial.timeframe,
      jobId: initial.id,
    });
    try {
      while (cursor <= target) {
        const current = jobRepository.get(initial.id);
        if (
          !current ||
          current.cancelRequested ||
          current.status === "CANCELLING"
        ) {
          await jobRepository.update(initial.id, {
            status: "CANCELLED",
            completedAt: new Date(),
          });
          await eventBus.emit({
            level: "WARN",
            component: "backfill",
            event: "BACKFILL_CANCELLED",
            message: "Backfill cancelled",
            jobId: initial.id,
            symbol: initial.symbol,
            timeframe: initial.timeframe,
          });
          return;
        }
        if (current.status !== "RUNNING") return;
        const requestEnd = Math.min(target, cursor + (1500 - 1) * step);
        const batch = (
          await binance.fetchKlines(
            initial.symbol,
            initial.timeframe,
            cursor,
            requestEnd,
            1500,
            "REST_BACKFILL",
          )
        ).filter((c) => c.closeTime.getTime() < binance.nowMs());
        requests++;
        downloaded += batch.length;
        if (!batch.length) {
          cursor = requestEnd + step;
          await jobRepository.update(initial.id, {
            checkpointTime: new Date(requestEnd),
            requestCount: requests,
          });
          continue;
        }
        const write = await candleRepository.upsertMany(batch, 5);
        persisted += write.rowsAffected;
        const last = batch.at(-1)!.openTime;
        cursor = last.getTime() + step;
        await jobRepository.update(initial.id, {
          checkpointTime: last,
          downloadedCandles: downloaded,
          persistedCandles: persisted,
          requestCount: requests,
        });
        await eventBus.emit({
          level: "DB",
          component: "backfill",
          event: "BACKFILL_PROGRESS",
          message: `Committed ${batch.length} candles`,
          symbol: initial.symbol,
          timeframe: initial.timeframe,
          jobId: initial.id,
          durationMs: Math.round(write.durationMs),
          rowsAffected: write.rowsAffected,
          queueDepth: 0,
          details: {
            downloaded,
            persisted,
            requests,
            checkpoint: last.toISOString(),
          },
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await gapService.scan(
        initial.symbol,
        initial.timeframe,
        initial.startTime,
        new Date(target),
      );
      if (initial.timeframe === "1m") {
        for (const timeframe of config.aggregatedTimeframes) {
          const lastFullBucket = new Date(
            bucketOpen(new Date(target), timeframe).getTime() -
              intervalMs(timeframe),
          );
          if (lastFullBucket >= initial.startTime)
            await aggregationEngine.rebuild(
              initial.symbol,
              timeframe,
              initial.startTime,
              lastFullBucket,
            );
        }
      }
      await jobRepository.update(initial.id, {
        status: "COMPLETED",
        estimatedCandles: persisted,
        completedAt: new Date(),
      });
      await eventBus.emit({
        level: "INFO",
        component: "backfill",
        event: "BACKFILL_COMPLETED",
        message: `Backfill completed: ${persisted} persisted`,
        symbol: initial.symbol,
        timeframe: initial.timeframe,
        jobId: initial.id,
        rowsAffected: persisted,
      });
    } catch (error) {
      this.healthy = false;
      await jobRepository.update(initial.id, {
        status: "FAILED",
        completedAt: new Date(),
        errorCode: (error as { code?: string }).code ?? "BACKFILL_ERROR",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
      await eventBus.emit({
        level: "ERROR",
        component: "backfill",
        event: "BACKFILL_FAILED",
        message: error instanceof Error ? error.message : "Backfill failed",
        symbol: initial.symbol,
        timeframe: initial.timeframe,
        jobId: initial.id,
        errorCode: (error as { code?: string }).code ?? "BACKFILL_ERROR",
      });
    }
  }
}
export const backfillWorker = new BackfillWorker();
