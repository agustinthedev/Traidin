import { strategyRepository, verificationRepository } from "../server/strategy/repository.js";
import { auditVerificationRun } from "../server/strategy/verification-audit.js";
import { REPORT_ENGINE_VERSION, ROBUSTNESS_ENGINE_VERSION, SIMULATION_ENGINE_VERSION, STRESS_ENGINE_VERSION, WALK_FORWARD_ENGINE_VERSION } from "../server/strategy/verification-worker.js";
import { MONTE_CARLO_ENGINE_VERSION } from "../server/strategy/monte-carlo.js";
import { METRICS_ENGINE_VERSION } from "../server/strategy/metrics.js";
import { VERIFICATION_EXPORT_VERSION } from "../server/strategy/export.js";
import { sqlite } from "../server/db/database.js";

const id = process.argv[2];
if (!id) throw new Error("Usage: npm exec tsx scripts/audit-verification-run.ts <verification-run-id>");
const run = verificationRepository.get(id);
if (!run) throw new Error(`Verification run not found: ${id}`);
const version = strategyRepository.version(run.strategyVersionId);
const audit = auditVerificationRun({ run, result: verificationRepository.result(id), trades: verificationRepository.trades(id, 1_000_000, 0) as Array<Record<string, unknown>>, costs: version?.configuration.costs, currentEngineVersion: SIMULATION_ENGINE_VERSION, currentMetricsVersion: METRICS_ENGINE_VERSION, currentMonteCarloVersion: MONTE_CARLO_ENGINE_VERSION, currentExportVersion: VERIFICATION_EXPORT_VERSION, currentWalkForwardVersion: WALK_FORWARD_ENGINE_VERSION, currentRobustnessVersion: ROBUSTNESS_ENGINE_VERSION, currentStressVersion: STRESS_ENGINE_VERSION, currentReportVersion: REPORT_ENGINE_VERSION });
await verificationRepository.updateAuditStatus(id, audit.status);
console.log(JSON.stringify(audit, null, 2));
sqlite.close();
