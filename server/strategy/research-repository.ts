import { randomUUID } from "node:crypto";
import { sqlite } from "../db/database.js";

type Row = Record<string, unknown>;
export type WorkerOwnership = {
  researchRunId: string;
  workerId: string;
  claimToken: string;
};
export class StaleWorkerError extends Error {
  readonly code = "STALE_WORKER_OWNERSHIP";
  constructor(
    public readonly ownership: WorkerOwnership,
    operation: string,
  ) {
    super(`Research worker lost ownership while performing ${operation}`);
    this.name = "StaleWorkerError";
  }
}
let activeOwnership: WorkerOwnership | null = null;
const ownershipFor = (researchRunId: string, ownership?: WorkerOwnership) =>
  ownership ??
  (activeOwnership?.researchRunId === researchRunId
    ? activeOwnership
    : undefined);
const assertAffected = (
  changes: number,
  ownership: WorkerOwnership | undefined,
  operation: string,
) => {
  if (ownership && changes !== 1)
    throw new StaleWorkerError(ownership, operation);
  return changes;
};
const date = (value: unknown) =>
  value == null ? null : new Date(Number(value));
const json = <T>(value: unknown, fallback: T): T => {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};
const bool = (value: unknown) => Number(value ?? 0) === 1;
const mapRun = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description),
  symbol: String(row.symbol),
  directions: String(row.directions),
  triggerTimeframe: String(row.trigger_timeframe),
  executionTimeframe: String(row.execution_timeframe),
  status: String(row.status),
  health: String(row.health),
  stage: String(row.stage),
  progress: Number(row.progress),
  candidateBudget: Number(row.candidate_budget),
  generatedCount: Number(row.generated_count),
  duplicateCount: Number(row.duplicate_count),
  structurallyRejectedCount: Number(row.structurally_rejected_count),
  isTestedCount: Number(row.is_tested_count),
  isSurvivorCount: Number(row.is_survivor_count),
  oosTestedCount: Number(row.oos_tested_count),
  oosSurvivorCount: Number(row.oos_survivor_count),
  finalistCount: Number(row.finalist_count),
  holdoutTestedCount: Number(row.holdout_tested_count),
  promotedCount: Number(row.promoted_count),
  generationAttemptCount: Number(row.generation_attempt_count ?? 0),
  generatedRawCount: Number(row.generated_raw_count ?? 0),
  generationErrorCount: Number(row.generation_error_count ?? 0),
  staticRejectedCount: Number(
    row.static_rejected_count ?? row.structurally_rejected_count ?? 0,
  ),
  preflightRejectedCount: Number(row.preflight_rejected_count ?? 0),
  exactDuplicateCount: Number(
    row.exact_duplicate_count ?? row.duplicate_count ?? 0,
  ),
  semanticDuplicateCount: Number(row.semantic_duplicate_count ?? 0),
  acceptedCandidateCount: Number(row.accepted_candidate_count ?? 0),
  acceptedValidUniqueCount: Number(
    row.accepted_valid_unique_count ?? row.accepted_candidate_count ?? 0,
  ),
  queuedForIsCount: Number(row.queued_for_is_count ?? 0),
  evaluatedInIsCount: Number(row.evaluated_in_is_count ?? 0),
  rejectedInIsCount: Number(row.rejected_in_is_count ?? 0),
  advancedToOosCount: Number(row.advanced_to_oos_count ?? 0),
  rejectedInOosCount: Number(row.rejected_in_oos_count ?? 0),
  advancedToHoldoutCount: Number(row.advanced_to_holdout_count ?? 0),
  rejectedInHoldoutCount: Number(row.rejected_in_holdout_count ?? 0),
  evaluationFailedCount: Number(row.evaluation_failed_count ?? 0),
  cancelledCount: Number(row.cancelled_count ?? 0),
  terminalPersisted: bool(row.terminal_persisted),
  exportedCount: Number(row.exported_count ?? 0),
  reconciliationStatus: String(row.reconciliation_status ?? "LEGACY"),
  reconciliationMismatch: Number(row.reconciliation_mismatch ?? 0),
  reconciliation: json<Record<string, unknown>>(row.reconciliation_json, {}),
  templateCounts: json<Record<string, unknown>>(row.template_counts_json, {}),
  predicateRoleCounts: json<Record<string, unknown>>(
    row.predicate_role_counts_json,
    {},
  ),
  sharedFilterCount: Number(row.shared_filter_count ?? 0),
  multiConditionCount: Number(row.multi_condition_count ?? 0),
  crossFamilyCount: Number(row.cross_family_count ?? 0),
  warmupPolicyVersion: String(row.warmup_policy_version ?? "legacy"),
  evaluatedCandidateCount: Number(row.evaluated_candidate_count ?? 0),
  unevaluatedCandidateCount: Number(row.unevaluated_candidate_count ?? 0),
  generationExhausted: bool(row.generation_exhausted),
  generationExhaustionReason: row.generation_exhaustion_reason
    ? String(row.generation_exhaustion_reason)
    : null,
  completionReason: row.completion_reason
    ? String(row.completion_reason)
    : null,
  completionMessage: row.completion_message
    ? String(row.completion_message)
    : null,
  terminalOutcome: String(row.terminal_outcome ?? "LEGACY"),
  maxGenerationAttempts:
    row.max_generation_attempts == null
      ? null
      : Number(row.max_generation_attempts),
  workerId: row.worker_id ? String(row.worker_id) : null,
  claimToken: row.claim_token ? String(row.claim_token) : null,
  claimedAt: date(row.claimed_at),
  leaseExpiresAt: date(row.lease_expires_at),
  heartbeatAt: date(row.heartbeat_at),
  lastProgressAt: date(row.last_progress_at),
  workerFailureCode: row.worker_failure_code
    ? String(row.worker_failure_code)
    : null,
  workerFailureMessage: row.worker_failure_message
    ? String(row.worker_failure_message)
    : null,
  grammarVersion: String(row.grammar_version ?? "legacy"),
  generationPolicy: json<Record<string, unknown>>(
    row.generation_policy_json,
    {},
  ),
  validationPolicy: json<Record<string, unknown>>(
    row.validation_policy_json,
    {},
  ),
  deduplicationPolicy: json<Record<string, unknown>>(
    row.deduplication_policy_json,
    {},
  ),
  costModel: json<Record<string, unknown>>(row.cost_model_json, {}),
  config: json<Record<string, unknown>>(row.config_json, {}),
  periods: json<Record<string, unknown>>(row.periods_json, {}),
  configHash: String(row.config_hash),
  datasetFingerprint: json<Record<string, unknown>>(
    row.dataset_fingerprint_json,
    {},
  ),
  engineVersion: String(row.engine_version),
  indicatorRegistryVersion: String(row.indicator_registry_version),
  searchAlgorithmVersion: String(row.search_algorithm_version),
  splitterVersion: String(row.splitter_version),
  randomSeed: Number(row.random_seed),
  holdoutEvaluated: bool(row.holdout_evaluated),
  holdoutExposed: bool(row.holdout_exposed),
  holdoutExposedAt: date(row.holdout_exposed_at),
  errorCode: row.error_code ? String(row.error_code) : null,
  errorMessage: row.error_message ? String(row.error_message) : null,
  createdAt: date(row.created_at)!,
  startedAt: date(row.started_at),
  completedAt: date(row.completed_at),
  updatedAt: date(row.updated_at)!,
});
const mapCandidate = (row: Row) => ({
  id: String(row.id),
  researchRunId: String(row.research_run_id),
  generationIndex: Number(row.generation_index),
  status: String(row.status),
  family: String(row.family),
  direction: String(row.direction),
  rawAst: json<Record<string, unknown>>(row.raw_ast_json, {}),
  normalizedAst: json<Record<string, unknown>>(row.normalized_ast_json, {}),
  normalizedHash: String(row.normalized_hash),
  semanticFingerprint: row.semantic_fingerprint
    ? String(row.semantic_fingerprint)
    : null,
  configuration: json<Record<string, unknown>>(row.configuration_json, {}),
  complexityScore: Number(row.complexity_score),
  complexityBreakdown: json<Record<string, unknown>>(
    row.complexity_breakdown_json,
    {},
  ),
  metrics: json<Record<string, unknown>>(row.metrics_json, {}),
  preflightMetrics: json<Record<string, unknown>>(
    row.preflight_metrics_json,
    {},
  ),
  preflightDiagnostics: json<Record<string, unknown>>(
    row.preflight_diagnostics_json,
    {},
  ),
  score: row.score == null ? null : Number(row.score),
  paretoRank: row.pareto_rank == null ? null : Number(row.pareto_rank),
  rejectionStage: row.rejection_stage ? String(row.rejection_stage) : null,
  rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
  stageRejectionReasons: json<Record<string, unknown>>(
    row.stage_rejection_reasons_json,
    {},
  ),
  validationStatus: row.validation_status
    ? String(row.validation_status)
    : null,
  validationErrors: json<unknown[]>(row.validation_errors_json, []),
  generationAttemptIndex:
    row.generation_attempt_index == null
      ? null
      : Number(row.generation_attempt_index),
  duplicateOfCandidateId: row.duplicate_of_candidate_id
    ? String(row.duplicate_of_candidate_id)
    : null,
  terminalReason: row.terminal_reason ? String(row.terminal_reason) : null,
  humanDescription: row.human_description
    ? String(row.human_description)
    : null,
  formatterVersion: String(row.formatter_version ?? "legacy"),
  generatorVersion: row.generator_version
    ? String(row.generator_version)
    : null,
  grammarVersion: row.grammar_version ? String(row.grammar_version) : null,
  registryVersion: row.registry_version ? String(row.registry_version) : null,
  templateIds: json<string[]>(row.template_ids_json, []),
  templateVersions: json<Record<string, string>>(
    row.template_versions_json,
    {},
  ),
  predicateMetadata: json<unknown[]>(row.predicate_metadata_json, []),
  structuralValidation: row.structural_validation
    ? String(row.structural_validation)
    : null,
  structuralActions: json<unknown[]>(row.structural_actions_json, []),
  simplifiedNormalizedHash: row.simplified_normalized_hash
    ? String(row.simplified_normalized_hash)
    : null,
  simplifiedNormalizedAst: json<Record<string, unknown> | null>(
    row.simplified_normalized_ast_json,
    null,
  ),
  promotedStrategyId: row.promoted_strategy_id
    ? String(row.promoted_strategy_id)
    : null,
  createdAt: date(row.created_at)!,
  updatedAt: date(row.updated_at)!,
});

const runTransitions: Record<string, string[]> = {
  DRAFT: ["QUEUED", "FAILED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLING", "CANCELLED", "FAILED"],
  INITIALIZING: ["RUNNING", "FAILED", "CANCELLING"],
  RUNNING: ["PAUSING", "CANCELLING", "COMPLETED", "FAILED"],
  PAUSING: ["PAUSED", "CANCELLING", "FAILED"],
  PAUSED: ["RESUMING", "QUEUED", "CANCELLING", "CANCELLED"],
  RESUMING: ["RUNNING", "FAILED", "CANCELLING"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
  CANCELLING: ["CANCELLED", "FAILED"],
  CANCELLED: ["QUEUED"],
};
const terminalCandidateStatuses = new Set([
  "STRUCTURAL_REJECTED",
  "IS_REJECTED",
  "OOS_REJECTED",
  "HOLDOUT_REJECTED",
  "COMPLETED",
  "PROMOTED",
  "PINNED",
  "REJECTED",
  "EVALUATION_FAILED",
]);
const assertRunTransition = (from: string, to: string) => {
  if (from === to || runTransitions[from]?.includes(to)) return;
  throw new Error(`Invalid Research Run transition ${from} -> ${to}`);
};

export const researchRepository = {
  setExecutionOwnership(ownership: WorkerOwnership) {
    activeOwnership = ownership;
  },
  clearExecutionOwnership(researchRunId: string, claimToken?: string) {
    if (
      activeOwnership?.researchRunId === researchRunId &&
      (!claimToken || activeOwnership.claimToken === claimToken)
    )
      activeOwnership = null;
  },
  activeExecutionOwnership() {
    return activeOwnership;
  },
  async create(input: {
    name: string;
    description: string;
    symbol: string;
    directions: string;
    triggerTimeframe: string;
    executionTimeframe: string;
    candidateBudget: number;
    config: unknown;
    periods: unknown;
    configHash: string;
    datasetFingerprint: unknown;
    engineVersion: string;
    indicatorRegistryVersion: string;
    searchAlgorithmVersion: string;
    splitterVersion: string;
    randomSeed: number;
  }) {
    const id = randomUUID(),
      now = Date.now();
    await sqlite.writer.enqueue(6, "research-run-create", (db) =>
      db
        .prepare(
          "INSERT INTO research_runs(id,name,description,symbol,directions,trigger_timeframe,execution_timeframe,status,health,stage,candidate_budget,config_json,periods_json,config_hash,dataset_fingerprint_json,engine_version,indicator_registry_version,search_algorithm_version,splitter_version,random_seed,terminal_outcome,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          input.name,
          input.description,
          input.symbol,
          input.directions,
          input.triggerTimeframe,
          input.executionTimeframe,
          "DRAFT",
          "UNKNOWN",
          "DRAFT",
          input.candidateBudget,
          JSON.stringify(input.config),
          JSON.stringify(input.periods),
          input.configHash,
          JSON.stringify(input.datasetFingerprint),
          input.engineVersion,
          input.indicatorRegistryVersion,
          input.searchAlgorithmVersion,
          input.splitterVersion,
          input.randomSeed,
          "PENDING",
          now,
          now,
        ),
    );
    return this.get(id)!;
  },
  get(id: string) {
    const row = sqlite.reader
      .prepare("SELECT * FROM research_runs WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapRun(row) : null;
  },
  list() {
    return (
      sqlite.reader
        .prepare(
          "SELECT * FROM research_runs ORDER BY created_at DESC LIMIT 200",
        )
        .all() as Row[]
    ).map(mapRun);
  },
  async delete(id: string) {
    return sqlite.writer.enqueue(6, "research-run-delete", (db) =>
      db.transaction(() => {
        const promotions = db
          .prepare(
            "SELECT count(*) count FROM research_candidate_promotions WHERE research_run_id=?",
          )
          .get(id) as { count: number };
        if (Number(promotions.count) > 0) return false;
        return (
          db.prepare("DELETE FROM research_runs WHERE id=?").run(id).changes > 0
        );
      })(),
    );
  },
  async update(
    id: string,
    fields: Record<string, unknown>,
    requestedOwnership?: WorkerOwnership,
  ) {
    const current = this.get(id);
    if (!current) return null;
    const ownership = ownershipFor(id, requestedOwnership);
    const columns: Record<string, string> = {
      status: "status",
      health: "health",
      stage: "stage",
      progress: "progress",
      generatedCount: "generated_count",
      duplicateCount: "duplicate_count",
      structurallyRejectedCount: "structurally_rejected_count",
      isTestedCount: "is_tested_count",
      isSurvivorCount: "is_survivor_count",
      oosTestedCount: "oos_tested_count",
      oosSurvivorCount: "oos_survivor_count",
      finalistCount: "finalist_count",
      holdoutTestedCount: "holdout_tested_count",
      promotedCount: "promoted_count",
      generationAttemptCount: "generation_attempt_count",
      generatedRawCount: "generated_raw_count",
      generationErrorCount: "generation_error_count",
      staticRejectedCount: "static_rejected_count",
      preflightRejectedCount: "preflight_rejected_count",
      exactDuplicateCount: "exact_duplicate_count",
      semanticDuplicateCount: "semantic_duplicate_count",
      acceptedCandidateCount: "accepted_candidate_count",
      acceptedValidUniqueCount: "accepted_valid_unique_count",
      queuedForIsCount: "queued_for_is_count",
      evaluatedInIsCount: "evaluated_in_is_count",
      rejectedInIsCount: "rejected_in_is_count",
      advancedToOosCount: "advanced_to_oos_count",
      rejectedInOosCount: "rejected_in_oos_count",
      advancedToHoldoutCount: "advanced_to_holdout_count",
      rejectedInHoldoutCount: "rejected_in_holdout_count",
      evaluationFailedCount: "evaluation_failed_count",
      cancelledCount: "cancelled_count",
      terminalPersisted: "terminal_persisted",
      exportedCount: "exported_count",
      reconciliationStatus: "reconciliation_status",
      reconciliationMismatch: "reconciliation_mismatch",
      reconciliation: "reconciliation_json",
      templateCounts: "template_counts_json",
      predicateRoleCounts: "predicate_role_counts_json",
      sharedFilterCount: "shared_filter_count",
      multiConditionCount: "multi_condition_count",
      crossFamilyCount: "cross_family_count",
      warmupPolicyVersion: "warmup_policy_version",
      evaluatedCandidateCount: "evaluated_candidate_count",
      unevaluatedCandidateCount: "unevaluated_candidate_count",
      generationExhausted: "generation_exhausted",
      generationExhaustionReason: "generation_exhaustion_reason",
      completionReason: "completion_reason",
      completionMessage: "completion_message",
      terminalOutcome: "terminal_outcome",
      maxGenerationAttempts: "max_generation_attempts",
      workerId: "worker_id",
      claimToken: "claim_token",
      claimedAt: "claimed_at",
      leaseExpiresAt: "lease_expires_at",
      heartbeatAt: "heartbeat_at",
      lastProgressAt: "last_progress_at",
      workerFailureCode: "worker_failure_code",
      workerFailureMessage: "worker_failure_message",
      grammarVersion: "grammar_version",
      generationPolicy: "generation_policy_json",
      validationPolicy: "validation_policy_json",
      deduplicationPolicy: "deduplication_policy_json",
      costModel: "cost_model_json",
      holdoutEvaluated: "holdout_evaluated",
      holdoutExposed: "holdout_exposed",
      holdoutExposedAt: "holdout_exposed_at",
      errorCode: "error_code",
      errorMessage: "error_message",
      startedAt: "started_at",
      completedAt: "completed_at",
    };
    const values = Object.entries(fields).filter(([key]) => columns[key]);
    if (!values.length) return current;
    if (fields.status)
      assertRunTransition(current.status, String(fields.status));
    await sqlite.writer.enqueue(6, "research-run-update", (db) => {
      const where = ownership
        ? " WHERE id=? AND worker_id=? AND claim_token=? AND lease_expires_at>? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING')"
        : " WHERE id=?";
      const result = db
        .prepare(
          `UPDATE research_runs SET ${values.map(([key]) => `${columns[key]}=?`).join(",")},updated_at=?${where}`,
        )
        .run(
          ...values.map(([key, value]) =>
            value instanceof Date
              ? value.getTime()
              : typeof value === "boolean"
                ? Number(value)
                : [
                      "generationPolicy",
                      "validationPolicy",
                      "deduplicationPolicy",
                      "costModel",
                      "reconciliation",
                      "templateCounts",
                      "predicateRoleCounts",
                    ].includes(key)
                  ? JSON.stringify(value ?? {})
                  : value,
          ),
          Date.now(),
          id,
          ...(ownership
            ? [ownership.workerId, ownership.claimToken, Date.now()]
            : []),
        );
      assertAffected(result.changes, ownership, "Research Run update");
      return result;
    });
    return this.get(id);
  },
  async launch(id: string) {
    return this.update(id, {
      status: "QUEUED",
      health: "HEALTHY",
      stage: "QUEUED",
      progress: 0,
      terminalOutcome: "PENDING",
      completionMessage: null,
      errorCode: null,
      errorMessage: null,
      workerFailureCode: null,
      workerFailureMessage: null,
      workerId: null,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      lastProgressAt: null,
    });
  },
  async claimNext(workerId: string, leaseMs = 120_000) {
    return sqlite.writer.enqueue(6, "research-run-claim", (db) =>
      db.transaction(() => {
        const row = db
          .prepare(
            "SELECT * FROM research_runs WHERE status IN ('QUEUED','RESUMING') ORDER BY created_at LIMIT 1",
          )
          .get() as Row | undefined;
        if (!row) return null;
        const now = Date.now(),
          claimToken = randomUUID();
        const result = db
          .prepare(
            "UPDATE research_runs SET status='RUNNING',health='HEALTHY',stage='INITIALIZING',started_at=COALESCE(started_at,?),worker_id=?,claim_token=?,claimed_at=?,lease_expires_at=?,heartbeat_at=?,last_progress_at=?,terminal_outcome='PENDING',updated_at=? WHERE id=? AND status IN ('QUEUED','RESUMING')",
          )
          .run(
            now,
            workerId,
            claimToken,
            now,
            now + leaseMs,
            now,
            now,
            now,
            row.id,
          );
        if (result.changes !== 1) return null;
        return mapRun({
          ...row,
          status: "RUNNING",
          health: "HEALTHY",
          stage: "INITIALIZING",
          started_at: row.started_at ?? now,
          worker_id: workerId,
          claim_token: claimToken,
          claimed_at: now,
          lease_expires_at: now + leaseMs,
          heartbeat_at: now,
          last_progress_at: now,
          terminal_outcome: "PENDING",
          updated_at: now,
        });
      })(),
    );
  },
  /** Explicit operator/retry action for an expired active lease. */
  async reclaimExpired(runId: string) {
    return sqlite.writer.enqueue(6, "research-run-reclaim-expired", (db) => {
      const now = Date.now();
      const result = db
        .prepare(
          "UPDATE research_runs SET status='QUEUED',health='DEGRADED',stage='QUEUED',terminal_outcome='PENDING',worker_id=NULL,claim_token=NULL,lease_expires_at=NULL,heartbeat_at=NULL,last_progress_at=NULL,updated_at=? WHERE id=? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING') AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
        )
        .run(now, runId, now);
      return result.changes === 1;
    });
  },
  async heartbeat(
    id: string,
    workerOrClaimToken: string,
    claimOrFields:
      string | { progress?: number; stage?: string; leaseMs?: number } = {},
    requestedFields: {
      progress?: number;
      stage?: string;
      leaseMs?: number;
    } = {},
  ) {
    const ownership = ownershipFor(id);
    const workerId = ownership?.workerId ?? workerOrClaimToken;
    const claimToken = ownership
      ? ownership.claimToken
      : typeof claimOrFields === "string"
        ? claimOrFields
        : workerOrClaimToken;
    const fields =
      typeof claimOrFields === "string" ? requestedFields : claimOrFields;
    const now = Date.now();
    const leaseMs = fields.leaseMs ?? 120_000;
    return sqlite.writer.enqueue(6, "research-run-heartbeat", (db) => {
      const values: unknown[] = [now + leaseMs, now, now];
      const columns = [
        "lease_expires_at=?",
        "heartbeat_at=?",
        "last_progress_at=?",
      ];
      if (fields.progress != null) {
        columns.push("progress=?");
        values.push(fields.progress);
      }
      if (fields.stage != null) {
        columns.push("stage=?");
        values.push(fields.stage);
      }
      const result = db
        .prepare(
          `UPDATE research_runs SET ${columns.join(",")},updated_at=? WHERE id=? AND worker_id=? AND claim_token=? AND lease_expires_at>? AND status IN ('RUNNING','PAUSING','CANCELLING')`,
        )
        .run(...values, now, id, workerId, claimToken, now);
      assertAffected(result.changes, ownership, "Research Run heartbeat");
      return result;
    });
  },
  async requestPause(id: string) {
    return this.update(id, { status: "PAUSING" });
  },
  async requestCancel(id: string) {
    return this.update(id, { status: "CANCELLING" });
  },
  async exposeHoldout(id: string) {
    const run = this.get(id);
    if (!run || !run.holdoutEvaluated || run.holdoutExposed) return run;
    const exposedAt = new Date();
    await this.update(id, {
      holdoutExposed: true,
      holdoutExposedAt: exposedAt,
    });
    await this.log(
      id,
      "INFO",
      "HOLDOUT",
      "HOLDOUT_EXPOSED",
      "Holdout results exposed to the user",
      { exposedAt: exposedAt.toISOString() },
    );
    return this.get(id);
  },
  async recoverStaleLeases() {
    return sqlite.writer.enqueue(6, "research-run-recover-stale", (db) => {
      const now = Date.now();
      return db
        .prepare(
          "UPDATE research_runs SET status='FAILED',health='UNHEALTHY',stage='FAILED',terminal_outcome='FAILED',error_code='WORKER_LEASE_EXPIRED',error_message='Research worker lease expired',completion_message='Research Run failed because its worker lease expired.',worker_failure_code='WORKER_LEASE_EXPIRED',worker_failure_message='No heartbeat was received before the lease expired.',terminal_persisted=1,lease_expires_at=NULL,updated_at=? WHERE status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING') AND (lease_expires_at IS NULL OR lease_expires_at<?)",
        )
        .run(now, now).changes;
    });
  },
  async failWorkerRuns(
    workerId: string,
    code = "WORKER_PROCESS_EXITED",
    message = "Research worker process exited before the run reached a terminal outcome.",
  ) {
    return sqlite.writer.enqueue(6, "research-run-worker-exit", (db) => {
      const now = Date.now();
      return db
        .prepare(
          "UPDATE research_runs SET status='FAILED',health='UNHEALTHY',stage='FAILED',terminal_outcome='FAILED',error_code=?,error_message=?,completion_message=?,worker_failure_code=?,worker_failure_message=?,terminal_persisted=1,lease_expires_at=NULL,updated_at=? WHERE worker_id=? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING')",
        )
        .run(code, message, message, code, message, now, workerId).changes;
    });
  },
  async recoverInterrupted() {
    return this.recoverStaleLeases();
  },
  async log(
    id: string,
    level: string,
    stage: string,
    eventType: string,
    message: string,
    details?: unknown,
    requestedOwnership?: WorkerOwnership,
  ) {
    const ownership = ownershipFor(id, requestedOwnership);
    await sqlite.writer.enqueue(7, "research-event", (db) => {
      if (ownership) {
        const owned = db
          .prepare(
            "SELECT 1 FROM research_runs WHERE id=? AND worker_id=? AND claim_token=? AND lease_expires_at>? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING')",
          )
          .get(id, ownership.workerId, ownership.claimToken, Date.now());
        if (!owned) throw new StaleWorkerError(ownership, "event log");
      }
      return db
        .prepare(
          "INSERT INTO research_events(id,research_run_id,timestamp,level,stage,event_type,message,details_json) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          id,
          Date.now(),
          level,
          stage,
          eventType,
          message,
          details === undefined ? null : JSON.stringify(details),
        );
    });
  },
  events(id: string) {
    return (
      sqlite.reader
        .prepare(
          "SELECT * FROM research_events WHERE research_run_id=? ORDER BY timestamp DESC LIMIT 2000",
        )
        .all(id) as Row[]
    ).map((row) => ({
      ...row,
      details: row.details_json ? json(row.details_json, null) : null,
      timestamp: date(row.timestamp),
    }));
  },
  async insertCandidate(input: {
    researchRunId: string;
    generationIndex: number;
    status: string;
    family: string;
    direction: string;
    rawAst: unknown;
    normalizedAst: unknown;
    normalizedHash: string;
    semanticFingerprint?: string | null;
    configuration: unknown;
    complexityScore: number;
    complexityBreakdown?: unknown;
    metrics?: unknown;
    preflightMetrics?: unknown;
    preflightDiagnostics?: unknown;
    score?: number | null;
    paretoRank?: number | null;
    rejectionStage?: string | null;
    rejectionReason?: string | null;
    validationStatus?: string | null;
    validationErrors?: unknown;
    generationAttemptIndex?: number | null;
    duplicateOfCandidateId?: string | null;
    terminalReason?: string | null;
    stageRejectionReasons?: unknown;
    humanDescription?: string | null;
    formatterVersion?: string | null;
    generatorVersion?: string | null;
    grammarVersion?: string | null;
    registryVersion?: string | null;
    templateIds?: string[];
    templateVersions?: Record<string, string>;
    predicateMetadata?: unknown[];
    structuralValidation?: string | null;
    structuralActions?: unknown[];
    simplifiedNormalizedHash?: string | null;
    simplifiedNormalizedAst?: unknown;
    ownership?: WorkerOwnership;
  }) {
    const id = randomUUID(),
      now = Date.now();
    try {
      const ownership = ownershipFor(input.researchRunId, input.ownership);
      await sqlite.writer.enqueue(7, "research-candidate-create", (db) => {
        if (ownership) {
          const owned = db
            .prepare(
              "SELECT 1 FROM research_runs WHERE id=? AND worker_id=? AND claim_token=? AND lease_expires_at>? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING')",
            )
            .get(
              input.researchRunId,
              ownership.workerId,
              ownership.claimToken,
              Date.now(),
            );
          if (!owned)
            throw new StaleWorkerError(ownership, "candidate persistence");
        }
        const result = db
          .prepare(
            "INSERT INTO research_candidates(id,research_run_id,generation_index,status,family,direction,raw_ast_json,normalized_ast_json,normalized_hash,configuration_json,complexity_score,metrics_json,score,pareto_rank,rejection_stage,rejection_reason,created_at,updated_at,semantic_fingerprint,generation_attempt_index,duplicate_of_candidate_id,validation_status,validation_errors_json,preflight_metrics_json,preflight_diagnostics_json,terminal_reason,stage_rejection_reasons_json,complexity_breakdown_json,human_description,formatter_version,generator_version,grammar_version,registry_version,template_ids_json,template_versions_json,predicate_metadata_json,structural_validation,structural_actions_json,simplified_normalized_hash,simplified_normalized_ast_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            input.researchRunId,
            input.generationIndex,
            input.status,
            input.family,
            input.direction,
            JSON.stringify(input.rawAst),
            JSON.stringify(input.normalizedAst),
            input.normalizedHash,
            JSON.stringify(input.configuration),
            input.complexityScore,
            JSON.stringify(input.metrics ?? {}),
            input.score ?? null,
            input.paretoRank ?? null,
            input.rejectionStage ?? null,
            input.rejectionReason ?? null,
            now,
            now,
            input.semanticFingerprint ?? null,
            input.generationAttemptIndex ?? null,
            input.duplicateOfCandidateId ?? null,
            input.validationStatus ?? null,
            JSON.stringify(input.validationErrors ?? []),
            JSON.stringify(input.preflightMetrics ?? {}),
            JSON.stringify(input.preflightDiagnostics ?? {}),
            input.terminalReason ?? null,
            JSON.stringify(input.stageRejectionReasons ?? {}),
            JSON.stringify(input.complexityBreakdown ?? {}),
            input.humanDescription ?? null,
            input.formatterVersion ?? "legacy",
            input.generatorVersion ?? null,
            input.grammarVersion ?? null,
            input.registryVersion ?? null,
            JSON.stringify(input.templateIds ?? []),
            JSON.stringify(input.templateVersions ?? {}),
            JSON.stringify(input.predicateMetadata ?? []),
            input.structuralValidation ?? null,
            JSON.stringify(input.structuralActions ?? []),
            input.simplifiedNormalizedHash ?? null,
            input.simplifiedNormalizedAst == null
              ? null
              : JSON.stringify(input.simplifiedNormalizedAst),
          );
        assertAffected(result.changes, ownership, "candidate persistence");
        return result;
      });
      return this.candidate(id)!;
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE")
        return null;
      throw error;
    }
  },
  candidate(id: string) {
    const row = sqlite.reader
      .prepare("SELECT * FROM research_candidates WHERE id=?")
      .get(id) as Row | undefined;
    return row ? mapCandidate(row) : null;
  },
  findByFingerprint(runId: string, fingerprint: string) {
    const row = sqlite.reader
      .prepare(
        "SELECT * FROM research_candidates WHERE research_run_id=? AND (normalized_hash=? OR semantic_fingerprint=?) ORDER BY generation_index LIMIT 1",
      )
      .get(runId, fingerprint, fingerprint) as Row | undefined;
    return row ? mapCandidate(row) : null;
  },
  async updateCandidate(
    id: string,
    fields: Record<string, unknown>,
    requestedOwnership?: WorkerOwnership,
  ) {
    const current = this.candidate(id);
    if (!current) return null;
    const columns: Record<string, string> = {
      status: "status",
      metrics: "metrics_json",
      preflightMetrics: "preflight_metrics_json",
      preflightDiagnostics: "preflight_diagnostics_json",
      score: "score",
      paretoRank: "pareto_rank",
      rejectionStage: "rejection_stage",
      rejectionReason: "rejection_reason",
      stageRejectionReasons: "stage_rejection_reasons_json",
      promotedStrategyId: "promoted_strategy_id",
      validationStatus: "validation_status",
      validationErrors: "validation_errors_json",
      terminalReason: "terminal_reason",
      humanDescription: "human_description",
      formatterVersion: "formatter_version",
      templateIds: "template_ids_json",
      templateVersions: "template_versions_json",
      predicateMetadata: "predicate_metadata_json",
      structuralValidation: "structural_validation",
      structuralActions: "structural_actions_json",
      simplifiedNormalizedHash: "simplified_normalized_hash",
      simplifiedNormalizedAst: "simplified_normalized_ast_json",
    };
    const values = Object.entries(fields).filter(([key]) => columns[key]);
    if (!values.length) return current;
    if (
      fields.status &&
      String(fields.status) !== current.status &&
      current.status !== String(fields.status) &&
      terminalCandidateStatuses.has(current.status)
    )
      throw new Error(
        `Invalid Candidate transition ${current.status} -> ${fields.status}`,
      );
    const ownership = ownershipFor(current.researchRunId, requestedOwnership);
    await sqlite.writer.enqueue(7, "research-candidate-update", (db) => {
      if (ownership) {
        const owned = db
          .prepare(
            "SELECT 1 FROM research_runs WHERE id=? AND worker_id=? AND claim_token=? AND lease_expires_at>? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING')",
          )
          .get(
            current.researchRunId,
            ownership.workerId,
            ownership.claimToken,
            Date.now(),
          );
        if (!owned) throw new StaleWorkerError(ownership, "candidate update");
      }
      const result = db
        .prepare(
          `UPDATE research_candidates SET ${values.map(([key]) => `${columns[key]}=?`).join(",")},updated_at=? WHERE id=?`,
        )
        .run(
          ...values.map(([key, value]) =>
            [
              "metrics",
              "preflightMetrics",
              "preflightDiagnostics",
              "stageRejectionReasons",
              "validationErrors",
            ].includes(key)
              ? JSON.stringify(value ?? {})
              : value,
          ),
          Date.now(),
          id,
        );
      assertAffected(result.changes, ownership, "candidate update");
      return result;
    });
    return this.candidate(id);
  },
  candidates(runId: string, limit = 100, offset = 0) {
    return (
      sqlite.reader
        .prepare(
          "SELECT * FROM research_candidates WHERE research_run_id=? ORDER BY score DESC NULLS LAST, generation_index LIMIT ? OFFSET ?",
        )
        .all(runId, limit, offset) as Row[]
    ).map(mapCandidate);
  },
  candidateCount(runId: string) {
    return Number(
      (
        sqlite.reader
          .prepare(
            "SELECT count(*) count FROM research_candidates WHERE research_run_id=?",
          )
          .get(runId) as { count: number }
      ).count,
    );
  },
  async reconcile(runId: string) {
    const row = sqlite.reader
      .prepare(
        "SELECT count(*) total, sum(status IN ('GENERATED','FINALIST')) transient, sum(status='STRUCTURAL_REJECTED') staticRejected, sum(validation_status='VALID') accepted, sum(validation_status='VALID' AND status NOT IN ('GENERATED','FINALIST')) evaluated FROM research_candidates WHERE research_run_id=?",
      )
      .get(runId) as Row;
    const counters = {
      acceptedCandidateCount: Number(row.accepted ?? 0),
      evaluatedCandidateCount: Number(row.evaluated ?? 0),
      unevaluatedCandidateCount: Number(row.transient ?? 0),
      staticRejectedCount: Number(row.staticRejected ?? 0),
      structurallyRejectedCount: Number(row.staticRejected ?? 0),
    };
    await this.update(runId, counters);
    return {
      ...counters,
      total: Number(row.total ?? 0),
      transient: Number(row.transient ?? 0),
    };
  },
  async insertGenerationAttempt(input: {
    researchRunId: string;
    attemptIndex: number;
    deterministicSeed?: number | null;
    rngPosition?: unknown;
    generatorVersion: string;
    grammarVersion: string;
    registryVersion: string;
    selectedIndicators?: unknown;
    selectedOutputs?: unknown;
    selectedTemplateIds?: unknown;
    proposedParameters?: unknown;
    result: string;
    rejectionCode?: string | null;
    rejectionMessage?: string | null;
    candidateId?: string | null;
    duplicateOfCandidateId?: string | null;
    durationMs?: number | null;
    diagnostic?: unknown;
    createdAt?: number;
    completedAt?: number;
    ownership?: WorkerOwnership;
  }) {
    const ownership = ownershipFor(input.researchRunId, input.ownership);
    return sqlite.writer.enqueue(7, "research-generation-attempt", (db) => {
      if (ownership) {
        const owned = db
          .prepare(
            "SELECT 1 FROM research_runs WHERE id=? AND worker_id=? AND claim_token=? AND lease_expires_at>? AND status IN ('RUNNING','INITIALIZING','PAUSING','CANCELLING')",
          )
          .get(
            input.researchRunId,
            ownership.workerId,
            ownership.claimToken,
            Date.now(),
          );
        if (!owned)
          throw new StaleWorkerError(
            ownership,
            "generation attempt persistence",
          );
      }
      const now = Date.now();
      return db
        .prepare(
          "INSERT INTO research_generation_attempts(id,research_run_id,attempt_index,deterministic_seed,rng_position_json,generator_version,grammar_version,registry_version,selected_indicators_json,selected_outputs_json,selected_template_ids_json,proposed_parameters_json,result,rejection_code,rejection_message,candidate_id,duplicate_of_candidate_id,duration_ms,diagnostic_json,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          input.researchRunId,
          input.attemptIndex,
          input.deterministicSeed ?? null,
          JSON.stringify(input.rngPosition ?? {}),
          input.generatorVersion,
          input.grammarVersion,
          input.registryVersion,
          JSON.stringify(input.selectedIndicators ?? []),
          JSON.stringify(input.selectedOutputs ?? []),
          JSON.stringify(input.selectedTemplateIds ?? []),
          JSON.stringify(input.proposedParameters ?? {}),
          input.result,
          input.rejectionCode ?? null,
          input.rejectionMessage ?? null,
          input.candidateId ?? null,
          input.duplicateOfCandidateId ?? null,
          input.durationMs ?? null,
          JSON.stringify(input.diagnostic ?? {}),
          input.createdAt ?? now,
          input.completedAt ?? now,
        );
    });
  },
  generationAttempts(runId: string) {
    return sqlite.reader
      .prepare(
        "SELECT * FROM research_generation_attempts WHERE research_run_id=? ORDER BY attempt_index",
      )
      .all(runId) as Row[];
  },
  async reconcileGeneration(
    runId: string,
    requestedOwnership?: WorkerOwnership,
  ) {
    const ownership = ownershipFor(runId, requestedOwnership);
    const row = sqlite.reader
      .prepare(
        "SELECT count(*) attempts, sum(result='GENERATION_ERROR') generationErrors, sum(result<>'GENERATION_ERROR') rawGenerated, sum(result='GENERATED') generated, sum(result IN ('STATIC_REJECTED','PREFLIGHT_REJECTED','EXACT_DUPLICATE','SEMANTIC_DUPLICATE','ACCEPTED_FOR_EVALUATION')) terminalRaw FROM research_generation_attempts WHERE research_run_id=?",
      )
      .get(runId) as Row;
    const attempts = Number(row.attempts ?? 0),
      generationErrors = Number(row.generationErrors ?? 0),
      rawGenerated = Number(row.rawGenerated ?? 0);
    const categoryTotal = Number(row.terminalRaw ?? 0);
    const mismatch =
      attempts -
      generationErrors -
      rawGenerated +
      (rawGenerated - categoryTotal);
    const status =
      mismatch === 0 &&
      attempts === generationErrors + rawGenerated &&
      rawGenerated === categoryTotal
        ? "RECONCILED"
        : "MISMATCH";
    const reconciliation = {
      attempts,
      generationErrors,
      rawGenerated,
      categoryTotal,
      mismatch,
      status,
    };
    await this.update(
      runId,
      {
        generationErrorCount: generationErrors,
        generationAttemptCount: attempts,
        generatedRawCount: rawGenerated,
        reconciliationStatus: status,
        reconciliationMismatch: mismatch,
        reconciliation,
      },
      ownership,
    );
    return reconciliation;
  },
  async recordPromotion(input: {
    candidateId: string;
    runId: string;
    strategyId: string;
    strategyVersionId: string;
    verificationRunId?: string | null;
    actor?: string | null;
    note?: string | null;
  }) {
    const id = randomUUID(),
      now = Date.now();
    await sqlite.writer.enqueue(6, "research-candidate-promotion", (db) =>
      db.transaction(() => {
        db.prepare(
          "INSERT INTO research_candidate_promotions(id,research_candidate_id,research_run_id,strategy_id,strategy_version_id,verification_run_id,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          input.candidateId,
          input.runId,
          input.strategyId,
          input.strategyVersionId,
          input.verificationRunId ?? null,
          input.actor ?? null,
          input.note ?? null,
          now,
        );
        db.prepare(
          "UPDATE research_candidates SET status='PROMOTED',promoted_strategy_id=?,terminal_reason='PROMOTED_BY_USER',updated_at=? WHERE id=?",
        ).run(input.strategyId, now, input.candidateId);
        db.prepare(
          "UPDATE research_runs SET promoted_count=promoted_count+1,updated_at=? WHERE id=?",
        ).run(now, input.runId);
      })(),
    );
    return { id, createdAt: new Date(now) };
  },
};
