import type { SimTrade } from "./simulation.js";

export const FEE_AUDIT_TOLERANCE = 1e-6;
export const FEE_AUDIT_WARNING_TOLERANCE = 1e-4;
type FeeType = "MAKER" | "TAKER";
type FeeConfig = { makerFeePct: number; takerFeePct: number };
type Fill = { price: number; quantity: number; feeRatePct?: number; feeType?: FeeType };

const median = (values: number[]) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b), middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
};
const rateForType = (type: FeeType, costs: FeeConfig) => (type === "MAKER" ? costs.makerFeePct : costs.takerFeePct) / 100;
const normalizedType = (value: unknown): FeeType => String(value ?? "TAKER").toUpperCase() === "MAKER" ? "MAKER" : "TAKER";
const detailRate = (details: Record<string, unknown>, leg: "entry" | "exit", costs: FeeConfig) => {
  const explicit = Number(details[`${leg}FeeRatePct`]);
  return Number.isFinite(explicit) ? explicit / 100 : rateForType(normalizedType(details[`${leg}FeeType`]), costs);
};
const fillRate = (fill: Fill, fallback: number, costs: FeeConfig) => {
  const explicit = Number(fill.feeRatePct);
  return Number.isFinite(explicit) ? explicit / 100 : fill.feeType ? rateForType(normalizedType(fill.feeType), costs) : fallback;
};
const sumFinite = (values: number[]) => values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);

/** Reconstruct persisted fees from every fill. Legacy trades use their leg-level details as a safe fallback. */
export function auditTradeFees(trades: SimTrade[], costs: FeeConfig) {
  const rows = trades.map((trade, index) => {
    const details = trade.details ?? {}, quantity = Math.abs(Number(trade.quantity));
    const entryType = normalizedType(details.entryFeeType), exitType = normalizedType(details.exitFeeType);
    const entryFallback = detailRate(details, "entry", costs), exitFallback = detailRate(details, "exit", costs);
    const entryFills = Array.isArray(details.entryFills) && details.entryFills.length ? details.entryFills as Fill[] : [{ price: Number(trade.entryPrice), quantity, feeRatePct: entryFallback * 100, feeType: entryType }];
    const exitFills = Array.isArray(details.exitFills) && details.exitFills.length ? details.exitFills as Fill[] : [{ price: Number(trade.exitPrice), quantity, feeRatePct: exitFallback * 100, feeType: exitType }];
    const reconstruct = (fills: Fill[], fallback: number) => fills.reduce((acc, fill) => {
      const price = Number(fill.price), fillQuantity = Math.abs(Number(fill.quantity)), notional = Math.abs(price * fillQuantity), rate = fillRate(fill, fallback, costs), fee = notional * rate;
      const type = fill.feeType ? normalizedType(fill.feeType) : rate === rateForType("MAKER", costs) ? "MAKER" : "TAKER";
      return { notional: acc.notional + (Number.isFinite(notional) ? notional : 0), fee: acc.fee + (Number.isFinite(fee) ? fee : 0), makerFee: acc.makerFee + (type === "MAKER" && Number.isFinite(fee) ? fee : 0), valid: acc.valid && Number.isFinite(price) && Number.isFinite(fillQuantity) && fillQuantity >= 0 };
    }, { notional: 0, fee: 0, makerFee: 0, valid: true });
    const entry = reconstruct(entryFills, entryFallback), exit = reconstruct(exitFills, exitFallback), reconstructedTotalFee = entry.fee + exit.fee;
    const persistedEntryFee = Number(details.entryFee), persistedExitFee = Number(details.exitFee), persistedTotalFee = Number(trade.fees), difference = persistedTotalFee - reconstructedTotalFee;
    const status = !entry.valid || !exit.valid || !Number.isFinite(persistedEntryFee) || !Number.isFinite(persistedExitFee) || !Number.isFinite(persistedTotalFee) ? "NOT_RECONSTRUCTABLE" : Math.abs(difference) <= FEE_AUDIT_TOLERANCE ? "PASS" : Math.abs(difference) <= FEE_AUDIT_WARNING_TOLERANCE ? "WARNING" : "FAIL";
    return { sequence: index + 1, persistedEntryFee, persistedExitFee, persistedTotalFee, reconstructedEntryFee: entry.fee, reconstructedExitFee: exit.fee, reconstructedTotalFee, entryNotional: entry.notional, exitNotional: exit.notional, entryRate: entryFallback, exitRate: exitFallback, entryMakerFee: entry.makerFee, exitMakerFee: exit.makerFee, difference, tolerance: FEE_AUDIT_TOLERANCE, status };
  });
  const totalEntryFees = sumFinite(rows.map((row) => row.persistedEntryFee)), totalExitFees = sumFinite(rows.map((row) => row.persistedExitFee)), totalFees = sumFinite(rows.map((row) => row.persistedTotalFee)), reconstructedFees = sumFinite(rows.map((row) => row.reconstructedTotalFee)), totalEntryNotional = sumFinite(rows.map((row) => row.entryNotional)), totalExitNotional = sumFinite(rows.map((row) => row.exitNotional)), totalTurnover = totalEntryNotional + totalExitNotional;
  const statuses = rows.map((row) => row.status), status = statuses.some((value) => value === "NOT_RECONSTRUCTABLE") ? "NOT_RECONSTRUCTABLE" : statuses.some((value) => value === "FAIL") ? "FAIL" : statuses.some((value) => value === "WARNING") ? "WARNING" : "PASS";
  const firstTime = trades[0]?.entryTime ?? 0, lastTime = trades.at(-1)?.exitTime ?? firstTime, years = Math.max((lastTime - firstTime) / 86_400_000 / 365, 1 / 365), makerFees = sumFinite(rows.map((row) => row.entryMakerFee + row.exitMakerFee));
  return {
    check: "EXPECTED_FEE_RECONCILIATION", status, tolerance: FEE_AUDIT_TOLERANCE, warningTolerance: FEE_AUDIT_WARNING_TOLERANCE, tradeCount: trades.length,
    totalEntryFees, totalExitFees, totalFees, reconstructedFees, feeDifference: totalFees - reconstructedFees,
    averageFeePerTrade: trades.length ? totalFees / trades.length : 0, medianFeePerTrade: median(rows.map((row) => row.persistedTotalFee).filter(Number.isFinite)),
    totalEntryNotional, totalExitNotional, totalTurnover, effectiveFeeRate: totalTurnover ? totalFees / totalTurnover : 0,
    feesPctInitialBalance: null, feesPctGrossTradingPnl: null, feesPerYear: totalFees / years, feesPer100Trades: trades.length ? totalFees / trades.length * 100 : 0,
    makerFees, takerFees: totalFees - makerFees, rateConversions: { makerFeePct: costs.makerFeePct, makerRateDecimal: costs.makerFeePct / 100, takerFeePct: costs.takerFeePct, takerRateDecimal: costs.takerFeePct / 100 }, rows,
  };
}
