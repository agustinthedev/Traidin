import type { SimTrade } from "./simulation.js";

export const FEE_AUDIT_TOLERANCE = 1e-6;
type FeeType = "MAKER" | "TAKER";
type FeeConfig = { makerFeePct: number; takerFeePct: number };
type Fill = { price: number; quantity: number; feeRatePct?: number; feeType?: FeeType };

const median = (values: number[]) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
};

const configuredRate = (type: FeeType, costs: FeeConfig) => (type === "MAKER" ? costs.makerFeePct : costs.takerFeePct) / 100;
const detailRate = (details: Record<string, unknown>, leg: "entry" | "exit", costs: FeeConfig) => {
  const explicit = Number(details[`${leg}FeeRatePct`]);
  if (Number.isFinite(explicit)) return explicit / 100;
  return configuredRate(String(details[`${leg}FeeType`] ?? "TAKER") as FeeType, costs);
};
const fillRate = (fill: Fill, fallback: number) => Number.isFinite(Number(fill.feeRatePct)) ? Number(fill.feeRatePct) / 100 : fallback;

/** Reconstructs persisted fees from every persisted fill. Legacy trades fall back to their leg-level details. */
export function auditTradeFees(trades: SimTrade[], costs: FeeConfig) {
  const rows = trades.map((trade, index) => {
    const details = trade.details ?? {}, quantity = Math.abs(Number(trade.quantity));
    const entryFallback = detailRate(details, "entry", costs), exitFallback = detailRate(details, "exit", costs);
    const entryFills = Array.isArray(details.entryFills) ? details.entryFills as Fill[] : [{ price: Number(trade.entryPrice), quantity }];
    const exitFills = Array.isArray(details.exitFills) ? details.exitFills as Fill[] : [{ price: Number(trade.exitPrice), quantity }];
    const entryNotional = entryFills.reduce((sum, fill) => sum + Math.abs(Number(fill.price) * Number(fill.quantity)), 0);
    const exitNotional = exitFills.reduce((sum, fill) => sum + Math.abs(Number(fill.price) * Number(fill.quantity)), 0);
    const reconstructedEntryFee = entryFills.reduce((sum, fill) => sum + Math.abs(Number(fill.price) * Number(fill.quantity)) * fillRate(fill, entryFallback), 0);
    const reconstructedExitFee = exitFills.reduce((sum, fill) => sum + Math.abs(Number(fill.price) * Number(fill.quantity)) * fillRate(fill, exitFallback), 0);
    const reconstructedTotalFee = reconstructedEntryFee + reconstructedExitFee;
    const persistedEntryFee = Number(details.entryFee), persistedExitFee = Number(details.exitFee), persistedTotalFee = Number(trade.fees);
    const difference = persistedTotalFee - reconstructedTotalFee;
    return {
      sequence: index + 1, persistedEntryFee, persistedExitFee, persistedTotalFee,
      reconstructedEntryFee, reconstructedExitFee, reconstructedTotalFee,
      entryNotional, exitNotional, entryRate: entryFallback, exitRate: exitFallback,
      difference, tolerance: FEE_AUDIT_TOLERANCE,
      status: !Number.isFinite(persistedEntryFee) || !Number.isFinite(persistedExitFee) || !Number.isFinite(persistedTotalFee)
        ? "NOT_RECONSTRUCTABLE"
        : Math.abs(difference) <= FEE_AUDIT_TOLERANCE ? "PASS" : "FAIL",
    };
  });
  const totalEntryFees = rows.reduce((sum, row) => sum + row.persistedEntryFee, 0);
  const totalExitFees = rows.reduce((sum, row) => sum + row.persistedExitFee, 0);
  const totalFees = rows.reduce((sum, row) => sum + row.persistedTotalFee, 0);
  const reconstructedFees = rows.reduce((sum, row) => sum + row.reconstructedTotalFee, 0);
  const totalEntryNotional = rows.reduce((sum, row) => sum + row.entryNotional, 0);
  const totalExitNotional = rows.reduce((sum, row) => sum + row.exitNotional, 0);
  const totalTurnover = totalEntryNotional + totalExitNotional;
  const statuses = rows.map((row) => row.status);
  const status = statuses.some((value) => value === "NOT_RECONSTRUCTABLE") ? "NOT_RECONSTRUCTABLE" : statuses.some((value) => value === "FAIL") ? "FAIL" : "PASS";
  const firstTime = trades[0]?.entryTime ?? 0, lastTime = trades.at(-1)?.exitTime ?? firstTime;
  const years = Math.max((lastTime - firstTime) / 86_400_000 / 365, 1 / 365);
  const makerFees = rows.reduce((sum, row, index) => {
    const details = trades[index]?.details ?? {};
    return sum + (String(details.entryFeeType ?? "TAKER") === "MAKER" ? row.persistedEntryFee : 0) + (String(details.exitFeeType ?? "TAKER") === "MAKER" ? row.persistedExitFee : 0);
  }, 0);
  return {
    check: "EXPECTED_FEE_RECONCILIATION", status, tolerance: FEE_AUDIT_TOLERANCE, tradeCount: trades.length,
    totalEntryFees, totalExitFees, totalFees, reconstructedFees, feeDifference: totalFees - reconstructedFees,
    averageFeePerTrade: trades.length ? totalFees / trades.length : 0, medianFeePerTrade: median(rows.map((row) => row.persistedTotalFee)),
    totalEntryNotional, totalExitNotional, totalTurnover, effectiveFeeRate: totalTurnover ? totalFees / totalTurnover : 0,
    feesPctInitialBalance: null, feesPctGrossTradingPnl: null, feesPerYear: totalFees / years, feesPer100Trades: trades.length ? totalFees / trades.length * 100 : 0,
    makerFees, takerFees: totalFees - makerFees, rows,
  };
}
