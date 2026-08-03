import type { Candle } from "../domain/candle.js";
import { candleRepository } from "../db/repository.js";
import { calculateIndicator, indicatorRegistry, type FeatureSeries, validateIndicator } from "./indicators.js";

export type FeatureRequest = { indicator: string; parameters?: Record<string, unknown>; timeframe: string; output?: string };
type Frame = { candles: Candle[]; features: Map<string, FeatureSeries> };
const key = (id: string, parameters: Record<string, unknown>) => `${id}:${JSON.stringify(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)))}`;

/** Point-in-time feature store. Every frame contains only complete, closed candles. */
export class FeatureEngine {
  private frames = new Map<string, Frame>();
  constructor(readonly symbol: string, readonly start: Date, readonly end: Date, private readonly source = candleRepository) {}
  load(timeframes: string[]) {
    for (const timeframe of new Set(timeframes)) {
      const candles = this.source.verificationRange(this.symbol, timeframe, this.start, this.end);
      this.frames.set(timeframe, { candles, features: new Map() });
    }
    return this;
  }
  ensure(request: FeatureRequest) {
    const definition = validateIndicator(request.indicator, request.parameters);
    const frame = this.frames.get(request.timeframe);
    if (!frame) throw new Error(`Timeframe ${request.timeframe} is not loaded`);
    const cacheKey = key(request.indicator, request.parameters ?? {});
    if (!frame.features.has(cacheKey)) frame.features.set(cacheKey, calculateIndicator(request.indicator, frame.candles, request.parameters));
    const output = request.output ?? definition.outputs[0];
    if (!definition.outputs.includes(output)) throw new Error(`${request.indicator} has no output ${output}`);
    return { values: frame.features.get(cacheKey)![output], definition };
  }
  /** Last closed candle at or before asOf. Never returns an open or later candle. */
  latestIndex(timeframe: string, asOf: Date) {
    const frame = this.frames.get(timeframe);
    if (!frame) throw new Error(`Timeframe ${timeframe} is not loaded`);
    let lo = 0, hi = frame.candles.length - 1, answer = -1, target = asOf.getTime();
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (frame.candles[mid].closeTime.getTime() <= target) { answer = mid; lo = mid + 1; } else hi = mid - 1; }
    return answer;
  }
  value(request: FeatureRequest, asOf: Date) {
    const { values, definition } = this.ensure(request); const index = this.latestIndex(request.timeframe, asOf);
    if (index < definition.warmupBars(request.parameters ?? {}) - 1) return Number.NaN;
    return index < 0 ? Number.NaN : values[index];
  }
  previousValue(request: FeatureRequest, asOf: Date) {
    const { values, definition } = this.ensure(request); const index = this.latestIndex(request.timeframe, asOf) - 1;
    if (index < definition.warmupBars(request.parameters ?? {}) - 1) return Number.NaN;
    return index < 0 ? Number.NaN : values[index];
  }
  price(field: "open" | "high" | "low" | "close", timeframe: string, asOf: Date) {
    const frame = this.frames.get(timeframe); if (!frame) throw new Error(`Timeframe ${timeframe} is not loaded`); const index = this.latestIndex(timeframe, asOf); return index < 0 ? Number.NaN : Number(frame.candles[index][field]);
  }
  candles(timeframe: string) { return this.frames.get(timeframe)?.candles ?? []; }
  nextCandle(timeframe: string, after: Date) { const candles = this.candles(timeframe); let lo = 0, hi = candles.length - 1, answer = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].openTime > after) { answer = mid; hi = mid - 1; } else lo = mid + 1; } return answer < 0 ? null : candles[answer]; }
  availability() { return [...this.frames].map(([timeframe, frame]) => ({ timeframe, first: frame.candles[0]?.openTime ?? null, last: frame.candles.at(-1)?.closeTime ?? null, count: frame.candles.length })); }
  usedIndicators() { return Object.values(indicatorRegistry); }
}
