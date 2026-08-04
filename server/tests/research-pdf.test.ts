import { describe, expect, it } from "vitest";
import { researchRunCandidatesReportPdf } from "../strategy/research-candidate-report.js";

const run = (terminalOutcome: string) => ({ id: "run", name: `PDF ${terminalOutcome}`, status: terminalOutcome === "PARTIAL" || terminalOutcome === "EXHAUSTED" ? "COMPLETED" : terminalOutcome, terminalOutcome, symbol: "BTCUSDT", directions: "LONG_AND_SHORT", triggerTimeframe: "1h", executionTimeframe: "5m", candidateBudget: 20, acceptedCandidateCount: terminalOutcome === "PARTIAL" ? 2 : 0, generationAttemptCount: 4, generatedRawCount: 4, generationErrorCount: 0, staticRejectedCount: 0, preflightRejectedCount: 4, exactDuplicateCount: 0, semanticDuplicateCount: 0, reconciliationStatus: "RECONCILED", reconciliationMismatch: 0, completionMessage: terminalOutcome, periods: {}, configHash: "hash", datasetFingerprint: { checksum: "fingerprint" }, randomSeed: 1 });
describe("Research Run PDF terminal outcomes", () => {
  for (const outcome of ["COMPLETED", "PARTIAL", "EXHAUSTED", "FAILED"]) it(`generates a valid PDF for ${outcome}`, async () => { const pdf = await researchRunCandidatesReportPdf({ run: run(outcome), candidates: [] }); expect(pdf.subarray(0, 4).toString()).toBe("%PDF"); expect(pdf.length).toBeGreaterThan(500); });
});
