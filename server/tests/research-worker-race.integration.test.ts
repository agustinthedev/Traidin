import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const directory = mkdtempSync(join(tmpdir(), "treidin-research-race-"));
let database: typeof import("../db/database.js");
let repository: typeof import("../strategy/research-repository.js");
beforeAll(async () => {
  process.env.DATABASE_URL = `sqlite:${join(directory, "race.db")}`;
  process.env.START_WORKERS = "false";
  database = await import("../db/database.js");
  repository = await import("../strategy/research-repository.js");
});
afterAll(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});
async function queued() {
  const id = await repository.researchRepository.create({
    name: "Race",
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
  await repository.researchRepository.launch(id.id);
  return id.id;
}
describe("research worker claim and lease races", () => {
  it("allows exactly one of two concurrent claims", async () => {
    const id = await queued();
    const [a, b] = await Promise.all([
      repository.researchRepository.claimNext("worker-a"),
      repository.researchRepository.claimNext("worker-b"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((a ?? b)?.id).toBe(id);
  });
  it("rejects a late write after an explicit expired-lease reclaim", async () => {
    const id = await queued();
    const a = await repository.researchRepository.claimNext("worker-a", 5);
    expect(a?.claimToken).toBeTruthy();
    database.sqlite.writerConnection
      .prepare("UPDATE research_runs SET lease_expires_at=? WHERE id=?")
      .run(Date.now() - 1, id);
    expect(await repository.researchRepository.reclaimExpired(id)).toBe(true);
    const b = await repository.researchRepository.claimNext("worker-b");
    expect(b?.workerId).toBe("worker-b");
    await expect(
      repository.researchRepository.update(
        id,
        { progress: 0.9 },
        { researchRunId: id, workerId: "worker-a", claimToken: a!.claimToken! },
      ),
    ).rejects.toMatchObject({ code: "STALE_WORKER_OWNERSHIP" });
  });
  it("marks a crashed worker run failed and does not re-execute it", async () => {
    const id = await queued();
    const claim =
      await repository.researchRepository.claimNext("crashed-worker");
    expect(claim?.id).toBe(id);
    expect(
      await repository.researchRepository.failWorkerRuns("crashed-worker"),
    ).toBe(1);
    expect(repository.researchRepository.get(id)?.terminalOutcome).toBe(
      "FAILED",
    );
    expect(
      await repository.researchRepository.claimNext("replacement"),
    ).toBeNull();
  });
  it("does not recover a lease that is still valid", async () => {
    const id = await queued();
    await repository.researchRepository.claimNext("healthy-worker", 120_000);
    database.sqlite.writerConnection
      .prepare("UPDATE research_runs SET lease_expires_at=? WHERE id=?")
      .run(Date.now() + 60_000, id);
    expect(await repository.researchRepository.recoverStaleLeases()).toBe(0);
    expect(repository.researchRepository.get(id)?.status).toBe("RUNNING");
  });
  it("rejects late writes after cancellation acknowledgement", async () => {
    const id = await queued();
    const claim =
      await repository.researchRepository.claimNext("cancel-worker");
    await repository.researchRepository.requestCancel(id);
    await repository.researchRepository.update(
      id,
      {
        status: "CANCELLED",
        terminalOutcome: "CANCELLED",
        completedAt: new Date(),
        leaseExpiresAt: null,
      },
      {
        researchRunId: id,
        workerId: "cancel-worker",
        claimToken: claim!.claimToken!,
      },
    );
    await expect(
      repository.researchRepository.update(
        id,
        { progress: 1 },
        {
          researchRunId: id,
          workerId: "cancel-worker",
          claimToken: claim!.claimToken!,
        },
      ),
    ).rejects.toMatchObject({ code: "STALE_WORKER_OWNERSHIP" });
  });
  it("rejects a heartbeat after its lease expires", async () => {
    const id = await queued();
    const claim = await repository.researchRepository.claimNext(
      "heartbeat-worker",
      5,
    );
    repository.researchRepository.setExecutionOwnership({
      researchRunId: id,
      workerId: "heartbeat-worker",
      claimToken: claim!.claimToken!,
    });
    database.sqlite.writerConnection
      .prepare("UPDATE research_runs SET lease_expires_at=? WHERE id=?")
      .run(Date.now() - 1, id);
    await expect(
      repository.researchRepository.heartbeat(id, claim!.claimToken!, {
        progress: 0.4,
      }),
    ).rejects.toMatchObject({ code: "STALE_WORKER_OWNERSHIP" });
  });
});
