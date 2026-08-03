import type { SimTrade } from "./simulation.js";
import { verificationMetrics } from "./metrics.js";

export const ACCOUNTING_TOLERANCE = 1e-6;
type Row = Record<string, unknown>;
type AuditStatus = "MATCH" | "ROUNDING_DIFFERENCE" | "MISMATCH" | "NOT_RECONSTRUCTABLE";

const number = (value: unknown) => Number(value ?? 0);
const details = (value: unknown): Row => {
  try { return typeof value === "string" ? JSON.parse(value) as Row : value as Row ?? {}; } catch { return {}; }
};
const compare = (metric: string, persistedValue: unknown, reconstructedValue: unknown, tolerance = ACCOUNTING_TOLERANCE) => {
  const persisted = number(persistedValue), reconstructed = number(reconstructedValue), difference = persisted - reconstructed, absolute = Math.abs(difference);
  return { metric, persistedValue: persisted, reconstructedValue: reconstructed, difference, tolerance, status: (absolute === 0 ? "MATCH" : absolute <= tolerance ? "ROUNDING_DIFFERENCE" : "MISMATCH") as AuditStatus };
};

export function persistedTradeToSimTrade(row: Row): SimTrade {
  const extra = details(row.details_json ?? row.details);
  return {
    side: String(row.side) as "LONG" | "SHORT", entryTime: number(row.entry_time ?? row.entryTime), exitTime: number(row.exit_time ?? row.exitTime), entryPrice: String(row.entry_price ?? row.entryPrice), exitPrice: String(row.exit_price ?? row.exitPrice), quantity: String(row.quantity), grossPnl: String(row.gross_pnl ?? row.grossPnl), netPnl: String(row.net_pnl ?? row.netPnl), fees: String(row.fees), returnPct: number(row.return_pct ?? row.returnPct), rMultiple: row.r_multiple == null ? null : number(row.r_multiple), maePct: number(row.mae_pct ?? row.maePct), mfePct: number(row.mfe_pct ?? row.mfePct), holdingMs: number(row.holding_ms ?? row.holdingMs), entryReason: String(row.entry_reason ?? row.entryReason ?? "UNKNOWN"), exitReason: String(row.exit_reason ?? row.exitReason ?? "UNKNOWN"), details: extra,
  };
}

export function reconstructedBalanceCurve(initialBalance: number, trades: SimTrade[]) {
  let balance = initialBalance;
  return [{ time: trades[0]?.entryTime ?? 0, balance }, ...trades.map((trade) => ({ time: trade.exitTime, balance: balance += number(trade.netPnl) }))];
}

export function auditVerificationRun(input: { run: Row; result: Row | null; trades: Row[]; currentEngineVersion: string; currentMetricsVersion: string; currentMonteCarloVersion: string; currentExportVersion: string }) {
  const initialBalance = number((input.run.options as Row | undefined)?.initialBalance), simTrades = input.trades.map(persistedTradeToSimTrade), persisted = input.result?.metrics as Row | undefined;
  const invalidOrder = simTrades.some((trade, index) => trade.entryTime >= trade.exitTime || (index > 0 && Number(input.trades[index - 1].sequence) >= Number(input.trades[index].sequence)));
  const duplicatedSequences = new Set<number>(); const sequenceDuplicate = input.trades.some((trade) => { const sequence = number(trade.sequence); if (duplicatedSequences.has(sequence)) return true; duplicatedSequences.add(sequence); return false; });
  const balance = reconstructedBalanceCurve(initialBalance, simTrades), metrics = verificationMetrics(simTrades, balance), grossPnl = simTrades.reduce((sum, trade) => sum + number(trade.grossPnl), 0), netPnl = simTrades.reduce((sum, trade) => sum + number(trade.netPnl), 0), fees = simTrades.reduce((sum, trade) => sum + number(trade.fees), 0), fundingPnl = simTrades.reduce((sum, trade) => sum + number(trade.details.fundingPnl ?? (number(trade.details.funding) * -1)), 0), slippageImpact = simTrades.reduce((sum, trade) => sum + number(trade.details.slippageImpact), 0);
  const accountingDifference = netPnl - (grossPnl - fees + fundingPnl), reconciliation = persisted ? [compare("tradeCount", persisted.tradeCount, simTrades.length, 0), compare("netProfit", persisted.netProfit, netPnl), compare("equityFinal", persisted.equityFinal, initialBalance + netPnl), compare("totalFees", persisted.totalFees, fees), compare("totalFunding", persisted.totalFunding, fundingPnl), compare("totalSlippageImpact", persisted.totalSlippageImpact, slippageImpact), compare("profitFactor", persisted.profitFactor, metrics.profitFactor), compare("expectancy", persisted.expectancy, metrics.expectancy), compare("maxDrawdownPct", persisted.maxDrawdownPct, metrics.maxDrawdownPct)] : [];
  const missingFields = simTrades.length ? ["entryFee", "exitFee", "initialStopPrice", "initialRiskAmount", "grossRMultiple", "netRMultiple", "balanceBefore", "balanceAfter"].filter((field) => simTrades.some((trade) => trade.details[field] == null)) : ["trades"];
  const engineOutdated = String(input.run.engineVersion) !== input.currentEngineVersion || String(input.run.metricsVersion) !== input.currentMetricsVersion || !input.run.monteCarloEngineVersion || String(input.run.monteCarloEngineVersion) !== input.currentMonteCarloVersion || !input.run.exportVersion || String(input.run.exportVersion) !== input.currentExportVersion;
  const mismatches = reconciliation.filter((item) => item.status === "MISMATCH"), status = !persisted || !simTrades.length ? "NOT_RECONSTRUCTABLE" : mismatches.length || Math.abs(accountingDifference) > ACCOUNTING_TOLERANCE || invalidOrder || sequenceDuplicate ? "FAIL" : missingFields.length || engineOutdated ? "WARNING" : "PASS";
  return { status, auditTimestamp: new Date().toISOString(), reconciliation, accounting: { initialBalance, grossPnl, netPnl, fees, fundingPnl, slippageImpact, finalBalance: initialBalance + netPnl, accountingDifference, slippageModel: "ADVERSE_FILL_PRICE_INCLUDED_IN_GROSS_PNL", fundingModel: simTrades.some((trade) => trade.details.fundingPnl != null) ? "SIGNED_FUNDING_PNL" : "LEGACY_FUNDING_CHARGE" }, tradeCounts: { persisted: simTrades.length, uniqueSequences: duplicatedSequences.size, invalidOrder, duplicateSequence: sequenceDuplicate }, missingFields, engineVersions: { simulation: input.run.engineVersion, metrics: input.run.metricsVersion, monteCarlo: input.run.monteCarloEngineVersion ?? "LEGACY_UNVERSIONED", export: input.run.exportVersion ?? "LEGACY_UNVERSIONED", current: { simulation: input.currentEngineVersion, metrics: input.currentMetricsVersion, monteCarlo: input.currentMonteCarloVersion, export: input.currentExportVersion } }, recommendedAction: engineOutdated ? "FULL_RERUN_REQUIRED" : missingFields.length ? "LEGACY_RUN_NOT_FULLY_RECONSTRUCTABLE" : mismatches.length ? "METRICS_RECALCULATION_REQUIRED" : "RUN_VALID" };
}
