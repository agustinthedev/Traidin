import type { Candle } from "../domain/candle.js";
import { config } from "../config.js";
import { BinanceKlineStream } from "../binance/stream.js";
import { candleRepository, gapRepository } from "../db/repository.js";
import { eventBus } from "../events/bus.js";
import { closedCandles, ingestLatency, persistedCandles, persistLatency, wsMessages } from "../observability.js";
import { liveState } from "../live-state.js";
import { aggregationEngine } from "./aggregation.js";
import { gapService } from "../services/gap-service.js";
import { binance } from "../binance/adapter.js";

export class LiveIngestionWorker {
  private stream?: BinanceKlineStream; private emitted = new Map<string, number>(); private lastOpenEventAt = new Map<string, number>(); healthy = false;
  start() { liveState.init(config.symbols); this.stream = new BinanceKlineStream(config.symbols, "1m", { onCandle: (c) => this.onCandle(c), onConnected: () => this.onConnected(), onDisconnected: (reason) => this.onDisconnected(reason), onStale: () => this.onStale() }); this.stream.start(); }
  stop() { this.stream?.stop(); }
  private onConnected() {
    liveState.websocketConnected = true;
    this.healthy = true;
    for (const state of liveState.symbols.values()) state.state = "HEALTHY";
    setTimeout(() => void this.verifyContinuity(), 5_000);
  }
  private async verifyContinuity() {
    if (!liveState.websocketFresh()) return;
    const expected = Math.floor(binance.nowMs() / 60_000) * 60_000 - 60_000;
    for (const symbol of config.symbols) {
      if (!liveState.websocketFresh()) return;
      const latest = candleRepository.latest(symbol, "1m");
      if (latest && latest.openTime.getTime() < expected)
        await gapService.scan(
          symbol,
          "1m",
          new Date(latest.openTime.getTime() + 60_000),
          new Date(expected),
        );
    }
  }
  private onDisconnected(reason: string) { void reason; liveState.websocketConnected = false; this.healthy = false; for (const state of liveState.symbols.values()) state.state = "DISCONNECTED"; }
  private async onStale() { this.healthy = false; for (const state of liveState.symbols.values()) state.state = "STALE"; await eventBus.emit({ level: "WARN", component: "live-ingestion", event: "STREAM_STALE", message: "No market messages for 15 seconds" }); }
  private async onCandle(candle: Candle) {
    wsMessages.inc(); liveState.messages++; const latency = Math.max(0, candle.receivedAt.getTime() + binance.serverTimeOffsetMs - (candle.eventTime?.getTime() ?? candle.receivedAt.getTime() + binance.serverTimeOffsetMs)); ingestLatency.observe(latency); const state = liveState.symbols.get(candle.symbol); if (!state) return;
    state.openCandle = candle.isClosed ? undefined : candle; state.lastMessageAt = candle.receivedAt.toISOString(); state.latencyMs = latency;
    const now = Date.now();
    const shouldEmitOpenUpdate =
      candle.isClosed || now - (this.lastOpenEventAt.get(candle.symbol) ?? 0) >= 1_000;
    if (shouldEmitOpenUpdate) {
      if (!candle.isClosed) this.lastOpenEventAt.set(candle.symbol, now);
      await eventBus.emit({ level: "DATA", component: "live-ingestion", event: candle.isClosed ? "CANDLE_CLOSED" : "CANDLE_OPEN_UPDATED", message: `${candle.symbol} 1m candle ${candle.isClosed ? "closed" : "updated"}`, symbol: candle.symbol, timeframe: "1m", details: candle.isClosed ? { openTime: candle.openTime.toISOString(), closeTime: candle.closeTime.toISOString(), source: candle.source, receivedAt: candle.receivedAt.toISOString() } : undefined }, candle.isClosed);
    }
    if (!candle.isClosed) return; const last = this.emitted.get(candle.symbol); if (last === candle.openTime.getTime()) return; this.emitted.set(candle.symbol, candle.openTime.getTime()); closedCandles.inc();
    const started = performance.now(); try { const write = await candleRepository.upsertMany([candle], 1); const latencyToPersist = performance.now() - started; persistLatency.observe(latencyToPersist); persistedCandles.inc(); liveState.persisted++; state.lastClosedCandle = candle; await eventBus.emit({ level: "DB", component: "persistence", event: "CANDLE_PERSISTED", message: `${candle.symbol} 1m candle persisted`, symbol: candle.symbol, timeframe: "1m", durationMs: Math.round(write.durationMs), rowsAffected: write.rowsAffected }); await aggregationEngine.onMinuteClosed(candle); } catch (error) { this.emitted.delete(candle.symbol); state.state = "ERROR"; await eventBus.emit({ level: "ERROR", component: "persistence", event: "SYSTEM_ERROR", message: error instanceof Error ? error.message : "Live persistence failed", symbol: candle.symbol, timeframe: "1m", errorCode: (error as { code?: string }).code ?? "PERSIST_FAILED" }); }
  }
}
export const liveIngestionWorker = new LiveIngestionWorker();
