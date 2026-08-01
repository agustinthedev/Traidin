export const intervalsMs: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000 };
export function intervalMs(value: string) { const ms = intervalsMs[value]; if (!ms) throw new Error(`Unsupported timeframe: ${value}`); return ms; }
export function bucketOpen(time: Date, timeframe: string) { const ms = intervalMs(timeframe); const epoch = time.getTime(); if (timeframe === "1w") { const mondayOffset = 3 * 86_400_000; return new Date(Math.floor((epoch + mondayOffset) / ms) * ms - mondayOffset); } return new Date(Math.floor(epoch / ms) * ms); }
export function expectedClose(open: Date, timeframe: string) { return new Date(open.getTime() + intervalMs(timeframe) - 1); }
export function alignCeil(time: Date, timeframe: string) { const bucket = bucketOpen(time, timeframe); return bucket.getTime() === time.getTime() ? bucket : new Date(bucket.getTime() + intervalMs(timeframe)); }
