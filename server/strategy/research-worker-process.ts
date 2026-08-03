import { researchWorker } from "./research-worker.js";

let shuttingDown = false;

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  researchWorker.stop();
  const exitCode = process.exitCode ?? 0;
  setTimeout(() => process.exit(exitCode), 25).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("uncaughtException", (error) => {
  console.error("Research worker uncaught exception", error);
  process.exitCode = 1;
  shutdown();
});
process.on("unhandledRejection", (error) => {
  console.error("Research worker unhandled rejection", error);
  process.exitCode = 1;
  shutdown();
});

researchWorker.start().catch((error) => {
  console.error("Research worker failed to start", error);
  process.exitCode = 1;
  shutdown();
});
