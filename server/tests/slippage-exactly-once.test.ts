import { describe, expect, it } from "vitest";
import {
  applySlippageForTest,
  reconcileTradeAccounting,
} from "../strategy/simulation.js";

describe("slippage exactly once", () => {
  it("worsens long fills and uses slipped prices in gross P&L", () => {
    const entry = Number(applySlippageForTest(100, "LONG", true, 50));
    const exit = Number(applySlippageForTest(110, "LONG", false, 50));
    expect(entry).toBe(100.5);
    expect(exit).toBe(109.45);
    const gross = (exit - entry) * 2;
    const entryFee = (entry * 2 * 0.04) / 100,
      exitFee = (exit * 2 * 0.04) / 100,
      funding = 0;
    expect(
      reconcileTradeAccounting({
        grossPnl: gross.toFixed(8),
        fees: (entryFee + exitFee).toFixed(8),
        details: { fundingPnl: funding },
      }),
    ).toBeCloseTo(gross - entryFee - exitFee, 8);
  });
  it("worsens short fills and does not apply a second slippage deduction", () => {
    const entry = Number(applySlippageForTest(100, "SHORT", true, 50));
    const exit = Number(applySlippageForTest(90, "SHORT", false, 50));
    expect(entry).toBe(99.5);
    expect(exit).toBe(90.45);
    const gross = (entry - exit) * 2;
    const fees = ((entry + exit) * 2 * 0.04) / 100;
    const net = reconcileTradeAccounting({
      grossPnl: gross.toFixed(8),
      fees: fees.toFixed(8),
      details: { fundingPnl: 0 },
    });
    expect(net).toBeCloseTo(gross - fees, 8);
    expect(net).not.toBeCloseTo(gross - fees - (0.5 + 0.45) * 2, 5);
  });
});
