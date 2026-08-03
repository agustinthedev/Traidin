import { describe, expect, it } from "vitest";
import { strategyConfigSchema } from "../strategy/model.js";
import { verificationMetrics } from "../strategy/metrics.js";
import { monteCarlo } from "../strategy/monte-carlo.js";
import { selectWalkForwardCandidate } from "../strategy/walk-forward.js";
import { auditTradeFees } from "../strategy/fee-audit.js";
import type { SimTrade } from "../strategy/simulation.js";

const trade = (grossPnl: number, fees: number, fundingPnl: number, netRMultiple: number): SimTrade => ({
  side: "LONG", entryTime: 1, exitTime: 2, entryPrice: "100", exitPrice: "100", quantity: "1",
  grossPnl: String(grossPnl), fees: String(fees), netPnl: String(grossPnl - fees + fundingPnl), returnPct: grossPnl - fees + fundingPnl,
  rMultiple: netRMultiple, grossRMultiple: grossPnl / 10, netRMultiple, maePct: 0, mfePct: 0, holdingMs: 1,
  entryReason: "CANDLE_CLOSED", exitReason: "END_OF_TEST", details: { entryFee: String(fees / 2), exitFee: String(fees / 2), fundingPnl: String(fundingPnl), slippageImpact: "3", initialRiskAmount: "10", grossRMultiple: grossPnl / 10, netRMultiple },
});

const fixedRiskConfig = strategyConfigSchema.parse({
  exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY",
  longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 10 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_RISK", riskPct: 10 }, leverage: { fixed: 1, maximum: 1 }, costs: {},
});

describe("verification accounting and Monte Carlo", () => {
  it("keeps gross, costs, funding and balance reconciliation explicit", () => {
    const trades = [trade(20, 3, -2, 1.5), trade(-10, 2, 1, -1.1)];
    const metrics = verificationMetrics(trades, [{ time: 0, balance: 100 }, { time: 1, balance: 115 }, { time: 2, balance: 104 }]);
    expect(metrics).toMatchObject({ grossPnl: 10, netProfit: 4, totalFees: 5, totalFunding: -1, balanceReconciliationDifference: 0, grossTradingProfit: 20, grossTradingLoss: -10 });
  });

  it("records ruin and never emits negative equity or drawdown below -100%", () => {
    const result = monteCarlo([trade(-200, 0, 0, -20)], 100, 20, 42, fixedRiskConfig);
    expect(result.ruinedPathCount).toBe(20);
    expect(result.ruinProbabilityPct).toBe(100);
    expect(result.paths.flat().every((value) => value >= 0)).toBe(true);
    expect([result.p05MaxDrawdownPct, result.medianMaxDrawdownPct, result.p95MaxDrawdownPct].every((value) => value >= -100 && value <= 0)).toBe(true);
  });

  it("does not select a losing or undersampled walk-forward candidate", () => {
    const result = selectWalkForwardCandidate([
      { periodMultiplier: .8, metrics: { tradeCount: 4, netProfit: 100, profitFactor: 2, maxDrawdownPct: -2 } },
      { periodMultiplier: 1, metrics: { tradeCount: 40, netProfit: -1, profitFactor: 1.4, maxDrawdownPct: -5 } },
    ]);
    expect(result.selected).toBeNull();
    expect(result.candidates.map((candidate) => candidate.eligibility.reasons.length)).toEqual([1, 1]);
  });

  it("reconciles maker/taker fees from fill notional without leverage double counting", () => {
    const costs = { makerFeePct: .02, takerFeePct: .05 };
    const makeTrade = (entryFeeType: "MAKER" | "TAKER", exitFeeType: "MAKER" | "TAKER"): SimTrade => ({ ...trade(1, 0, 0, 1), entryPrice: "100", exitPrice: "110", quantity: "2", fees: String(100 * 2 * (entryFeeType === "MAKER" ? .0002 : .0005) + 110 * 2 * (exitFeeType === "MAKER" ? .0002 : .0005)), details: { entryFee: String(100 * 2 * (entryFeeType === "MAKER" ? .0002 : .0005)), exitFee: String(110 * 2 * (exitFeeType === "MAKER" ? .0002 : .0005)), entryFeeType, exitFeeType, entryFeeRatePct: entryFeeType === "MAKER" ? .02 : .05, exitFeeRatePct: exitFeeType === "MAKER" ? .02 : .05 } });
    for (const [entry, exit] of [["MAKER", "MAKER"], ["TAKER", "TAKER"], ["TAKER", "MAKER"], ["MAKER", "TAKER"]] as Array<["MAKER" | "TAKER", "MAKER" | "TAKER"]>) {
      const result = auditTradeFees([makeTrade(entry, exit)], costs);
      expect(result.status).toBe("PASS");
      expect(result.totalTurnover).toBe(420);
    }
  });

  it("reconciles a large export and exposes turnover-based effective fee rate", () => {
    const rows = Array.from({ length: 1_001 }, () => trade(1, 0.1, 0, 1));
    const result = auditTradeFees(rows, { makerFeePct: .02, takerFeePct: .05 });
    expect(result.tradeCount).toBe(1_001);
    expect(result.status).toBe("PASS");
    expect(result.feeDifference).toBeCloseTo(0);
    expect(result.effectiveFeeRate).toBeGreaterThan(0);
  });
});
