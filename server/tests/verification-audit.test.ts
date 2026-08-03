import { describe, expect, it } from "vitest";
import { auditVerificationRun, reconstructedBalanceCurve } from "../strategy/verification-audit.js";
import { verificationMetrics } from "../strategy/metrics.js";
import { tradeCsvHeader, tradeCsvLine } from "../strategy/export.js";

const rows = [
  { sequence: 1, side: "LONG", entry_time: 1, exit_time: 2, entry_price: "100", exit_price: "110", quantity: "1", gross_pnl: "10", net_pnl: "8", fees: "2", return_pct: 8, r_multiple: .8, mae_pct: -1, mfe_pct: 10, holding_ms: 1, entry_reason: "SIGNAL", exit_reason: "TARGET", details_json: JSON.stringify({ slippageImpact: "1", fundingPnl: "0", entryFee: "1", exitFee: "1", initialStopPrice: "90", initialRiskAmount: "10", grossRMultiple: "1", netRMultiple: ".8", balanceBefore: "100", balanceAfter: "108" }) },
  { sequence: 2, side: "SHORT", entry_time: 3, exit_time: 4, entry_price: "100", exit_price: "105", quantity: "1", gross_pnl: "-5", net_pnl: "-7", fees: "2", return_pct: -7, r_multiple: -.7, mae_pct: -5, mfe_pct: 1, holding_ms: 1, entry_reason: "SIGNAL", exit_reason: "STOP", details_json: JSON.stringify({ slippageImpact: "1", fundingPnl: "0", entryFee: "1", exitFee: "1", initialStopPrice: "110", initialRiskAmount: "10", grossRMultiple: "-.5", netRMultiple: "-.7", balanceBefore: "108", balanceAfter: "101" }) },
];

describe("verification audit and complete trade export", () => {
  it("reconciles persisted accounting from immutable trades", () => {
    const simTrades = rows.map((row) => ({ side: row.side as "LONG" | "SHORT", entryTime: row.entry_time, exitTime: row.exit_time, entryPrice: row.entry_price, exitPrice: row.exit_price, quantity: row.quantity, grossPnl: row.gross_pnl, netPnl: row.net_pnl, fees: row.fees, returnPct: row.return_pct, rMultiple: row.r_multiple, maePct: row.mae_pct, mfePct: row.mfe_pct, holdingMs: row.holding_ms, entryReason: row.entry_reason, exitReason: row.exit_reason, details: JSON.parse(row.details_json) }));
    const metrics = verificationMetrics(simTrades, reconstructedBalanceCurve(100, simTrades));
    const audit = auditVerificationRun({ run: { options: { initialBalance: 100 }, engineVersion: "current", metricsVersion: "current", monteCarloEngineVersion: "current", exportVersion: "current" }, result: { metrics }, trades: rows, currentEngineVersion: "current", currentMetricsVersion: "current", currentMonteCarloVersion: "current", currentExportVersion: "current" });
    expect(audit.status).toBe("PASS"); expect(audit.accounting).toMatchObject({ grossPnl: 5, netPnl: 1, fees: 4, finalBalance: 101, accountingDifference: 0 }); expect(audit.reconciliation.every((item) => item.status === "MATCH")).toBe(true);
  });
  it("exports every row after the UI pagination boundary without duplicates", () => {
    const all = Array.from({ length: 1_501 }, (_, index) => ({ ...rows[index % 2], sequence: index + 1 }));
    const csv = tradeCsvHeader() + all.map((row) => tradeCsvLine("run", "version", row)).join("");
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(1_502); expect(new Set(lines.slice(1).map((line) => line.split(",")[2])).size).toBe(1_501);
  });
});
