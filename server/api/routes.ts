import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, runtimeSettings, safeConfig } from "../config.js";
import {
  candleRepository,
  eventRepository,
  gapRepository,
  jobRepository,
  metadataRepository,
  systemStateRepository,
} from "../db/repository.js";
import {
  backup,
  checkpoint,
  databaseOverview,
  optimize,
} from "../db/maintenance.js";
import { eventBus } from "../events/bus.js";
import { liveState } from "../live-state.js";
import { metrics } from "../observability.js";
import { backfillWorker } from "../workers/backfill.js";
import { gapRepairWorker } from "../workers/gap-repair.js";
import { aggregationEngine } from "../workers/aggregation.js";
import { gapService } from "../services/gap-service.js";
import { refreshMetadata } from "../services/metadata-service.js";
import { liveIngestionWorker } from "../workers/live-ingestion.js";

const date = z.coerce.date();
const symbol = z
  .string()
  .regex(/^[A-Z0-9_]+$/)
  .transform((s) => s.toUpperCase());
export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/status", async () => ({
    ...liveState.snapshot(),
    database: databaseOverview(),
    config: safeConfig(),
    jobs: jobRepository.list().slice(0, 20),
    gaps: gapRepository.list(true),
  }));
  app.get("/api/streams", async () => liveState.snapshot().symbols);
  app.get("/api/candles/recent/:symbol", async (request) => {
    const p = z.object({ symbol }).parse(request.params);
    const q = z
      .object({
        timeframe: z.string().default("1m"),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
      })
      .parse(request.query);
    return candleRepository.recent(p.symbol, q.timeframe, q.limit);
  });
  app.get("/api/candles", async (request) => {
    const q = z
      .object({
        symbol,
        timeframe: z.string(),
        start: date,
        end: date,
        limit: z.coerce.number().int().min(1).max(5000).default(1000),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    return {
      rows: candleRepository.range(
        q.symbol,
        q.timeframe,
        q.start,
        q.end,
        q.limit,
        q.offset,
      ),
      total: candleRepository.count(q.symbol, q.timeframe, q.start, q.end),
      limit: q.limit,
      offset: q.offset,
    };
  });
  app.get("/api/coverage", async () => candleRepository.coverage());
  app.get("/api/jobs", async () => jobRepository.list());
  app.post("/api/jobs", async (request, reply) => {
    const body = z
      .object({
        symbol,
        timeframe: z.string(),
        startTime: date,
        endTime: date.optional(),
        untilNow: z.boolean().default(true),
      })
      .parse(request.body);
    const job = await backfillWorker.create(body);
    return reply.code(202).send(job);
  });
  app.post("/api/jobs/:id/cancel", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return jobRepository.update(id, {
      status: "CANCELLING",
      cancelRequested: true,
    });
  });
  app.post("/api/jobs/:id/pause", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return jobRepository.update(id, { status: "PAUSED" });
  });
  app.post("/api/jobs/:id/retry", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return jobRepository.update(id, {
      status: "PENDING",
      cancelRequested: false,
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    });
  });
  app.get("/api/gaps", async (request) => {
    const { active } = z
      .object({ active: z.coerce.boolean().default(false) })
      .parse(request.query);
    return gapRepository.list(active);
  });
  app.post("/api/gaps/scan", async (request) => {
    const body = z
      .object({
        symbol,
        timeframe: z.string().default("1m"),
        start: date,
        end: date,
      })
      .parse(request.body);
    return gapService.scan(body.symbol, body.timeframe, body.start, body.end);
  });
  app.post("/api/gaps/repair", async (_request, reply) => {
    void gapRepairWorker.runOnce();
    return reply.code(202).send({ accepted: true });
  });
  app.post("/api/aggregations/rebuild", async (request, reply) => {
    const body = z
      .object({ symbol, timeframe: z.string(), start: date, end: date })
      .parse(request.body);
    void aggregationEngine.rebuild(
      body.symbol,
      body.timeframe,
      body.start,
      body.end,
    );
    return reply.code(202).send({ accepted: true });
  });
  app.post("/api/aggregations/reconcile", async () => ({
    rebuilt: await aggregationEngine.reconcileIncomplete(),
  }));
  app.get("/api/metadata", async () => metadataRepository.list());
  app.post("/api/metadata/refresh", async () => ({
    refreshed: await refreshMetadata(config.symbols),
  }));
  app.get("/api/events", async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(2000).default(500) })
      .parse(request.query);
    return eventRepository.list(limit);
  });
  app.get("/api/events/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    reply.raw.write(
      `event: ready\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = eventBus.on((event) =>
      reply.raw.write(
        `event: market-event\ndata: ${JSON.stringify(event)}\n\n`,
      ),
    );
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      15_000,
    );
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.get("/api/health", async () => {
    const db = databaseOverview();
    const components = {
      application: "HEALTHY",
      sqlite: db.integrity === "ok" ? "HEALTHY" : "UNHEALTHY",
      writer: db.writer.queueDepth < 100 ? "HEALTHY" : "DEGRADED",
      binanceRest: liveState.restHealthy ? "HEALTHY" : "UNHEALTHY",
      binanceWebSocket: liveState.websocketConnected ? "HEALTHY" : "UNHEALTHY",
      historicalWorker: backfillWorker.healthy ? "HEALTHY" : "DEGRADED",
      gapRepair: gapRepairWorker.healthy ? "HEALTHY" : "DEGRADED",
      aggregation: aggregationEngine.healthy ? "HEALTHY" : "DEGRADED",
      liveIngestion: liveIngestionWorker.healthy ? "HEALTHY" : "SYNCING",
    };
    const overall =
      Object.values(components).every((v) => v === "HEALTHY") &&
      gapRepository.list(true).length === 0
        ? "HEALTHY"
        : Object.values(components).includes("UNHEALTHY")
          ? "UNHEALTHY"
          : "DEGRADED";
    return { status: overall, components, checkedAt: new Date().toISOString() };
  });
  app.get("/api/symbols", async () => ({
    enabled: config.symbols,
    metadata: metadataRepository.list(),
  }));
  app.get("/api/settings", async () => ({
    effective: runtimeSettings(),
    saved: systemStateRepository.get("runtime-settings") ?? runtimeSettings(),
  }));
  app.put("/api/settings", async (request) => {
    const settings = z
      .object({
        symbols: z.array(symbol).min(1).max(50),
        aggregatedTimeframes: z
          .array(z.enum(["5m", "15m", "1h", "4h", "1d", "1w"]))
          .min(1),
        eventRetentionDays: z.coerce.number().int().min(1).max(3650),
        streamsEnabled: z.boolean(),
      })
      .parse(request.body);
    const clean = {
      ...settings,
      symbols: [...new Set(settings.symbols)],
      aggregatedTimeframes: [...new Set(settings.aggregatedTimeframes)],
    };
    await systemStateRepository.set("runtime-settings", clean);
    await eventBus.emit({
      level: "INFO",
      component: "settings",
      event: "SETTINGS_SAVED",
      message:
        "Runtime settings saved; restart required to apply stream changes",
    });
    return { saved: clean, restartRequired: true };
  });
  app.get("/api/database", async () => databaseOverview());
  app.post("/api/database/checkpoint", async () => ({
    result: await checkpoint("PASSIVE"),
  }));
  app.post("/api/database/optimize", async () => optimize());
  app.post("/api/database/backup", async () => backup());
  app.get("/metrics", async (_request, reply) =>
    reply.type(metrics.contentType).send(await metrics.metrics()),
  );
}
