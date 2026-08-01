import { EventEmitter } from "node:events";
import { eventRepository } from "../db/repository.js";
export type EventLevel = "DEBUG" | "INFO" | "DATA" | "DB" | "AGG" | "REPAIR" | "WARN" | "ERROR";
export interface MarketEvent { id?: string; timestamp: string; level: EventLevel; component: string; event: string; message: string; symbol?: string; timeframe?: string; jobId?: string; durationMs?: number; rowsAffected?: number; queueDepth?: number; errorCode?: string; details?: unknown }
class EventBus {
  private emitter = new EventEmitter();
  on(listener: (event: MarketEvent) => void) { this.emitter.on("event", listener); return () => this.emitter.off("event", listener); }
  async emit(input: Omit<MarketEvent, "timestamp">, persist = true) {
    const event: MarketEvent = { timestamp: new Date().toISOString(), ...input };
    if (persist) { try { const saved = await eventRepository.append(input); event.id = saved.id; event.timestamp = saved.timestamp.toISOString(); } catch (error) { if (process.env.NODE_ENV !== "test") console.error(JSON.stringify({ event: "EVENT_PERSIST_FAILED", message: error instanceof Error ? error.message : "unknown" })); } }
    this.emitter.emit("event", event); return event;
  }
}
export const eventBus = new EventBus();
