import type { Candle } from "./domain/candle.js";
export type StreamState = "HEALTHY" | "SYNCING" | "GAP_DETECTED" | "REPAIRING" | "STALE" | "DISCONNECTED" | "ERROR";
export interface SymbolLiveState { symbol: string; state: StreamState; openCandle?: Candle; lastClosedCandle?: Candle; lastMessageAt?: string; latencyMs?: number; reconnectCount: number; activeGaps: number }
class LiveStateStore { startedAt = new Date(); websocketConnected = false; restHealthy = false; databaseHealthy = false; messages = 0; persisted = 0; aggregated = 0; repairedGaps = 0; symbols = new Map<string, SymbolLiveState>();
  init(symbols: string[]) { for (const symbol of symbols) this.symbols.set(symbol, { symbol, state: "SYNCING", reconnectCount: 0, activeGaps: 0 }); }
  websocketFresh(now = Date.now()) { const states = [...this.symbols.values()]; return this.websocketConnected && states.length > 0 && states.every((state) => state.lastMessageAt && now - Date.parse(state.lastMessageAt) <= 15_000); }
  snapshot() { return { startedAt: this.startedAt.toISOString(), uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000), websocketConnected: this.websocketConnected, websocketFresh: this.websocketFresh(), restHealthy: this.restHealthy, databaseHealthy: this.databaseHealthy, messages: this.messages, persisted: this.persisted, aggregated: this.aggregated, repairedGaps: this.repairedGaps, symbols: [...this.symbols.values()] }; }
}
export const liveState = new LiveStateStore();
