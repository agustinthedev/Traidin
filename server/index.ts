import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  applyRuntimeSettings,
  config,
  type RuntimeSettings,
} from "./config.js";
import { sqlite } from "./db/database.js";
import { pruneEvents } from "./db/maintenance.js";
import { eventBus } from "./events/bus.js";
import { liveState } from "./live-state.js";
import { binance } from "./binance/adapter.js";
import { registerRoutes } from "./api/routes.js";
import { refreshMetadata } from "./services/metadata-service.js";
import { backfillWorker } from "./workers/backfill.js";
import { gapRepairWorker } from "./workers/gap-repair.js";
import { liveIngestionWorker } from "./workers/live-ingestion.js";
import { aggregationEngine } from "./workers/aggregation.js";
import { verificationWorker } from "./strategy/verification-worker.js";
import { systemStateRepository } from "./db/repository.js";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { researchRepository } from "./strategy/research-repository.js";

let researchWorkerProcess: ChildProcess | null = null;
let researchWorkerId: string | null = null;
let shuttingDown = false;

function spawnResearchWorker() {
  if (shuttingDown || researchWorkerProcess) return;
  researchWorkerId = `research-worker-${process.pid}-${Date.now()}`;
  const workerPath = fileURLToPath(new URL("./strategy/research-worker-process.ts", import.meta.url));
  const child = fork(workerPath, [], {
    env: { ...process.env, TREIDIN_RESEARCH_WORKER_ID: researchWorkerId },
    execArgv: process.execArgv,
    stdio: "inherit",
  });
  researchWorkerProcess = child;
  child.once("exit", (code, signal) => {
    researchWorkerProcess = null;
    const workerId = researchWorkerId;
    researchWorkerId = null;
    if (workerId) void researchRepository.failWorkerRuns(workerId);
    if (!shuttingDown) {
      app.log.error({ code, signal }, "Research worker process exited; restarting it");
      setTimeout(spawnResearchWorker, 1000).unref();
    }
  });
  child.once("error", (error) => app.log.error(error, "Research worker process error"));
}

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    redact: [
      "req.headers.authorization",
      "req.headers.x-mbx-apikey",
      "*.apiKey",
      "*.apiSecret",
      "*.BINANCE_API_KEY",
      "*.BINANCE_API_SECRET",
    ],
  },
});
await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "DELETE"] });
await registerRoutes(app);
async function start() {
  const savedSettings =
    systemStateRepository.get<RuntimeSettings>("runtime-settings");
  if (savedSettings) applyRuntimeSettings(savedSettings);
  liveState.databaseHealthy = sqlite.stats().integrity === "ok";
  await pruneEvents();
  try {
    await binance.ping();
    liveState.restHealthy = true;
    await eventBus.emit({
      level: "INFO",
      component: "binance-rest",
      event: "REST_HEALTHY",
      message: "Binance REST is reachable",
    });
    await refreshMetadata(config.symbols);
  } catch (error) {
    liveState.restHealthy = false;
    await eventBus.emit({
      level: "ERROR",
      component: "startup",
      event: "SYSTEM_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Binance initialization failed",
      errorCode: "BINANCE_STARTUP",
    });
  }
  if (config.START_WORKERS === "true") {
    liveIngestionWorker.start();
    aggregationEngine.start();
    await gapRepairWorker.start();
    await backfillWorker.start();
  }
  verificationWorker.start();
  spawnResearchWorker();
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  await eventBus.emit({
    level: "INFO",
    component: "application",
    event: "APPLICATION_STARTED",
    message: `API listening on ${config.API_HOST}:${config.API_PORT}`,
  });
}
async function shutdown() {
  shuttingDown = true;
  liveIngestionWorker.stop();
  backfillWorker.stop();
  gapRepairWorker.stop();
  aggregationEngine.stop();
  verificationWorker.stop();
  if (researchWorkerProcess && !researchWorkerProcess.killed) researchWorkerProcess.kill("SIGTERM");
  researchWorkerProcess = null;
  await app.close();
  sqlite.close();
}
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
start().catch((error) => {
  app.log.error(error);
  sqlite.close();
  process.exit(1);
});
