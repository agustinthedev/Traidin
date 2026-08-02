import type { Candle } from "../domain/candle.js";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { normalizeWsKline } from "../binance/normalize.js";
import { candleRepository, gapRepository } from "../db/repository.js";
import { eventBus } from "../events/bus.js";
import { closedCandles, ingestLatency, persistedCandles, persistLatency, wsMessages } from "../observability.js";
import { liveState } from "../live-state.js";
import { aggregationEngine } from "./aggregation.js";
import { gapService } from "../services/gap-service.js";
import { binance } from "../binance/adapter.js";

export class LiveIngestionWorker {
  private child?: ChildProcess; private connectedSymbols = new Set<string>(); private restartTimer?: NodeJS.Timeout; private emitted = new Map<string, number>(); private lastOpenEventAt = new Map<string, number>(); healthy = false;
  start() {
    if (this.child) return;
    liveState.init(config.symbols);
    this.startChild();
  }
  stop() { if (this.restartTimer) clearTimeout(this.restartTimer); this.restartTimer = undefined; this.child?.send({ type: "stop" }); this.child?.kill(); this.child = undefined; this.connectedSymbols.clear(); }
  private startChild() {
    const childPath = fileURLToPath(new URL("./live-stream-child.ts", import.meta.url));
    const child = fork(childPath, [], { execArgv: ["--import", "tsx"], serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"] });
    this.child = child;
    child.on("message", (message: { type: string; symbol?: string; raw?: string; receivedAt?: number; message?: string; code?: string }) => this.onChildMessage(message));
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.connectedSymbols.clear();
      liveState.websocketConnected = false;
      for (const state of liveState.symbols.values()) state.state = "DISCONNECTED";
      this.restartTimer = setTimeout(() => this.startChild(), 1_000);
    });
    child.send({ type: "start", symbols: config.symbols, baseUrl: config.BINANCE_WS_URL });
  }
  private onChildMessage(message: { type: string; symbol?: string; raw?: string; receivedAt?: number; message?: string; code?: string }) {
    const symbol = message.symbol;
    if (!symbol) return;
    if (message.type === "connected") return this.onConnected(symbol);
    if (message.type === "disconnected") return this.onDisconnected(symbol, message.code ?? "closed");
    if (message.type === "stale") return void this.onStale(symbol);
    if (message.type === "error") { void eventBus.emit({ level: "WARN", component: "binance-ws", event: "WEBSOCKET_ERROR", message: `Live stream child error: ${message.message ?? "unknown"}`, symbol, errorCode: message.code }); return; }
    if (message.type === "candle" && message.raw && message.receivedAt) {
      try { void this.onCandle(normalizeWsKline(JSON.parse(message.raw), new Date(message.receivedAt))); }
      catch (error) { void eventBus.emit({ level: "ERROR", component: "binance-ws", event: "DATA_VALIDATION_FAILED", message: error instanceof Error ? error.message : "Invalid child payload", symbol, errorCode: "PAYLOAD_INVALID" }); }
    }
  }
  private onConnected(symbol: string) {
    this.connectedSymbols.add(symbol);
    liveState.websocketConnected = this.connectedSymbols.size > 0;
    const state = liveState.symbols.get(symbol);
    if (state) state.state = "HEALTHY";
    this.healthy = liveState.websocketFresh();
    if (this.connectedSymbols.size === config.symbols.length)
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
  private onDisconnected(symbol: string, reason: string) { void reason; this.connectedSymbols.delete(symbol); liveState.websocketConnected = this.connectedSymbols.size > 0; this.healthy = false; const state = liveState.symbols.get(symbol); if (state) state.state = "DISCONNECTED"; }
  private async onStale(symbol: string) { this.healthy = false; const state = liveState.symbols.get(symbol); if (state) state.state = "STALE"; await eventBus.emit({ level: "WARN", component: "live-ingestion", event: "STREAM_STALE", message: `${symbol} has not received market messages for 15 seconds`, symbol }); }
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
