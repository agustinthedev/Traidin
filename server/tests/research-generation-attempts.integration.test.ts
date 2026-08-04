import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
const directory = mkdtempSync(join(tmpdir(), "treidin-generation-attempts-"));
let database: typeof import("../db/database.js");
let repository: typeof import("../strategy/research-repository.js");
beforeAll(async () => {
  process.env.DATABASE_URL = `sqlite:${join(directory, "attempts.db")}`;
  process.env.START_WORKERS = "false";
  database = await import("../db/database.js");
  repository = await import("../strategy/research-repository.js");
});
afterAll(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
async function run() {
  const value = await repository.researchRepository.create({
    name: "Attempts",
    description: "",
    symbol: "BTCUSDT",
    directions: "LONG_AND_SHORT",
    triggerTimeframe: "1h",
    executionTimeframe: "5m",
    candidateBudget: 1,
    config: {},
    periods: {},
    configHash: randomUUID(),
    datasetFingerprint: {},
    engineVersion: "test",
    indicatorRegistryVersion: "test",
    searchAlgorithmVersion: "test",
    splitterVersion: "test",
    randomSeed: 1,
  });
  await repository.researchRepository.launch(value.id);
  const claim = await repository.researchRepository.claimNext("attempt-worker");
  return {
    id: value.id,
    ownership: {
      researchRunId: value.id,
      workerId: "attempt-worker",
      claimToken: claim!.claimToken!,
    },
  };
}
describe("durable generation attempt reconciliation", () => {
  it("reconciles every terminal generation category", async () => {
    const { id, ownership } = await run();
    const results = [
      "GENERATION_ERROR",
      "STATIC_REJECTED",
      "PREFLIGHT_REJECTED",
      "EXACT_DUPLICATE",
      "SEMANTIC_DUPLICATE",
      "ACCEPTED_FOR_EVALUATION",
    ];
    for (let index = 0; index < results.length; index++)
      await repository.researchRepository.insertGenerationAttempt({
        researchRunId: id,
        attemptIndex: index + 1,
        generatorVersion: "test",
        grammarVersion: "test",
        registryVersion: "test",
        result: results[index]!,
        ownership,
      });
    const reconciliation =
      await repository.researchRepository.reconcileGeneration(id, ownership);
    expect(reconciliation.status).toBe("RECONCILED");
    expect(reconciliation.attempts).toBe(6);
    expect(repository.researchRepository.get(id)?.reconciliationStatus).toBe(
      "RECONCILED",
    );
  });
  it("detects an unexplained generated attempt", async () => {
    const { id, ownership } = await run();
    await repository.researchRepository.insertGenerationAttempt({
      researchRunId: id,
      attemptIndex: 1,
      generatorVersion: "test",
      grammarVersion: "test",
      registryVersion: "test",
      result: "GENERATED",
      ownership,
    });
    const reconciliation =
      await repository.researchRepository.reconcileGeneration(id, ownership);
    expect(reconciliation.status).toBe("MISMATCH");
    expect(reconciliation.mismatch).not.toBe(0);
  });
});
