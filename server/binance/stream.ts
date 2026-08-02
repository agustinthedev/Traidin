import { config } from "../config.js";
import { eventBus } from "../events/bus.js";
import { reconnects } from "../observability.js";
import { normalizeWsKline } from "./normalize.js";
import type { Candle } from "../domain/candle.js";

export interface StreamHandlers { onCandle(candle: Candle): void | Promise<void>; onConnected(): void | Promise<void>; onDisconnected(reason: string): void | Promise<void>; onStale(): void | Promise<void> }
export class BinanceKlineStream {
  private socket?: WebSocket; private stopped = true; private attempt = 0; private generation = 0; private lastMessageAt = 0; private watchdog?: NodeJS.Timeout;
  constructor(private symbols: string[], private interval: string, private handlers: StreamHandlers, private baseUrl = config.BINANCE_WS_URL) {}
  start() { if (!this.stopped) return; this.stopped = false; this.watchdog = setInterval(() => { if (this.socket?.readyState === WebSocket.OPEN && this.lastMessageAt && Date.now() - this.lastMessageAt > 15_000) { void this.handlers.onStale(); this.replaceStaleSocket(); } }, 3000); this.connect(); }
  stop() { this.stopped = true; this.generation++; if (this.watchdog) clearInterval(this.watchdog); this.socket?.close(1000, "shutdown"); }
  private connect() {
    if (this.stopped) return; const generation = ++this.generation; const url = new URL(this.baseUrl); url.searchParams.set("streams", this.symbols.map((s) => `${s.toLowerCase()}@kline_${this.interval}`).join("/")); const socket = new WebSocket(url); this.socket = socket;
    socket.addEventListener("open", () => { if (generation !== this.generation) return socket.close(); this.attempt = 0; this.lastMessageAt = Date.now(); void eventBus.emit({ level: "INFO", component: "binance-ws", event: "WEBSOCKET_CONNECTED", message: `Subscribed ${this.symbols.join(", ")} ${this.interval}` }); void this.handlers.onConnected(); });
    socket.addEventListener("message", (message) => { if (generation !== this.generation) return; this.lastMessageAt = Date.now(); try { const payload = JSON.parse(String(message.data)) as unknown; const candle = normalizeWsKline(payload, new Date()); void this.handlers.onCandle(candle); } catch (error) { void eventBus.emit({ level: "ERROR", component: "binance-ws", event: "DATA_VALIDATION_FAILED", message: error instanceof Error ? error.message : "Invalid WebSocket payload", errorCode: "PAYLOAD_INVALID" }); } });
    socket.addEventListener("error", () => { void eventBus.emit({ level: "WARN", component: "binance-ws", event: "WEBSOCKET_ERROR", message: "WebSocket transport error" }); });
    socket.addEventListener("close", (close) => { if (generation !== this.generation) return; void this.handlers.onDisconnected(`${close.code} ${close.reason}`.trim()); void eventBus.emit({ level: "WARN", component: "binance-ws", event: "WEBSOCKET_DISCONNECTED", message: `WebSocket disconnected (${close.code})` }); if (!this.stopped) void this.reconnect(generation); });
  }
  private replaceStaleSocket() {
    const previous = this.socket;
    this.generation++;
    this.lastMessageAt = 0;
    previous?.close(4000, "stale stream");
    setTimeout(() => {
      if (!this.stopped) this.connect();
    }, 250);
  }
  private async reconnect(generation: number) { const wait = Math.min(30_000, 750 * 2 ** Math.min(this.attempt++, 6)) + Math.random() * 500; reconnects.inc(); await eventBus.emit({ level: "INFO", component: "binance-ws", event: "WEBSOCKET_RECONNECTING", message: `Reconnecting in ${Math.round(wait)} ms`, durationMs: Math.round(wait) }); await new Promise((resolve) => setTimeout(resolve, wait)); if (!this.stopped && generation === this.generation) this.connect(); }
}
