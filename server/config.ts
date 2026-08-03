import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("sqlite:///./data/trading-platform.db"),
  SQLITE_BACKUP_DIR: z.string().default("./data/backups"),
  SQLITE_BATCH_SIZE: z.coerce.number().int().min(100).max(10_000).default(5000),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  BINANCE_REST_URL: z.string().url().default("https://fapi.binance.com"),
  BINANCE_WS_URL: z
    .string()
    .url()
    .default("wss://fstream.binance.com/market/stream"),
  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  ENABLED_SYMBOLS: z.string().default("BTCUSDT,ETHUSDT"),
  AGGREGATED_TIMEFRAMES: z.string().default("5m,15m,1h,4h,1d,1w"),
  LOG_LEVEL: z.string().default("info"),
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  DATA_QUALITY_SCAN_INTERVAL_MS: z.coerce.number().int().min(30_000).max(86_400_000).default(300_000),
  GAP_REPAIR_STALL_TIMEOUT_MS: z.coerce.number().int().min(120_000).max(86_400_000).default(600_000),
  START_WORKERS: z.enum(["true", "false"]).default("true"),
});
const env = envSchema.parse(process.env);
const csv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
export const config = {
  ...env,
  symbols: csv(env.ENABLED_SYMBOLS).map((s) => s.toUpperCase()),
  aggregatedTimeframes: csv(env.AGGREGATED_TIMEFRAMES),
  credentials: {
    apiKeyConfigured: Boolean(env.BINANCE_API_KEY),
    apiSecretConfigured: Boolean(env.BINANCE_API_SECRET),
  },
};
export type RuntimeSettings = {
  symbols: string[];
  aggregatedTimeframes: string[];
  eventRetentionDays: number;
  streamsEnabled: boolean;
};
export function applyRuntimeSettings(settings: RuntimeSettings) {
  config.symbols = settings.symbols;
  config.aggregatedTimeframes = settings.aggregatedTimeframes;
  config.EVENT_RETENTION_DAYS = settings.eventRetentionDays;
  config.START_WORKERS = settings.streamsEnabled ? "true" : "false";
}
export function runtimeSettings(): RuntimeSettings {
  return {
    symbols: config.symbols,
    aggregatedTimeframes: config.aggregatedTimeframes,
    eventRetentionDays: config.EVENT_RETENTION_DAYS,
    streamsEnabled: config.START_WORKERS === "true",
  };
}
export function safeConfig() {
  return {
    database: "SQLite (local)",
    restUrl: config.BINANCE_REST_URL,
    wsUrl: config.BINANCE_WS_URL,
    symbols: config.symbols,
    aggregatedTimeframes: config.aggregatedTimeframes,
    sqliteBatchSize: config.SQLITE_BATCH_SIZE,
    eventRetentionDays: config.EVENT_RETENTION_DAYS,
    dataQualityScanIntervalMs: config.DATA_QUALITY_SCAN_INTERVAL_MS,
    gapRepairStallTimeoutMs: config.GAP_REPAIR_STALL_TIMEOUT_MS,
    streamsEnabled: config.START_WORKERS === "true",
    credentials: config.credentials,
  };
}
