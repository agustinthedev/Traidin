import { describe, expect, it } from "vitest";
import { evaluateCondition } from "../strategy/condition-engine.js";
import { FeatureEngine } from "../strategy/feature-engine.js";
import { calculateIndicator, indicatorRegistry } from "../strategy/indicators.js";
import { configurationDiff } from "../api/routes.js";
import { candle } from "./fixtures.js";
import { strategyConfigSchema, strategyWarmupBars, validateStrategyConfiguration } from "../strategy/model.js";
import { simulate } from "../strategy/simulation.js";
import { verificationMetrics } from "../strategy/metrics.js";

const frame = Array.from({ length: 30 }, (_, i) => candle(Date.UTC(2026, 0, 1, 0, i), { open: String(100 + i), high: String(101 + i), low: String(99 + i), close: String(100 + i), volume: String(10 + i), takerBuyBaseVolume: String(5 + i / 2) }));
describe("indicator registry calculations", () => {
  it("provides every declared output for every registry entry", () => {
    for (const definition of Object.values(indicatorRegistry)) {
      const values = calculateIndicator(definition.id, frame);
      expect(Object.keys(values).sort()).toEqual([...definition.outputs].sort());
    }
  });
  it("warms up EMA and never writes values before its period", () => { const values = calculateIndicator("ema", frame, { period: 5 }).ema; expect(Number.isNaN(values[3])).toBe(true); expect(values[4]).toBeCloseTo(102); expect(values[5]).toBeGreaterThan(values[4]); });
  it("derives candle-level taker ratio as a documented candle proxy", () => { const values = calculateIndicator("taker_buy_ratio", frame).taker_buy_ratio; expect(values[0]).toBeCloseTo(.5); expect(values[10]).toBeCloseTo(10 / 20); });
  it("calculates MACD after both the slow and signal warmups", () => { const macd = calculateIndicator("macd", frame, { fast: 3, slow: 6, signal: 3 }); expect(Number.isNaN(macd.macd[5])).toBe(false); expect(Number.isNaN(macd.signal[7])).toBe(false); expect(Number.isNaN(macd.histogram[7])).toBe(false); });
  it("calculates rolling momentum, volume and candle-flow features after warmup", () => { expect(calculateIndicator("stochastic", frame, { period: 5 }).stochastic_k[10]).toBeGreaterThanOrEqual(0); expect(calculateIndicator("cci", frame, { period: 5 }).cci[10]).toBeTypeOf("number"); expect(calculateIndicator("relative_quote_volume", frame, { period: 5 }).relative_quote_volume[10]).toBeGreaterThan(0); expect(Number.isNaN(calculateIndicator("delta_ema", frame, { period: 5 }).delta_ema[10])).toBe(false); });
  it("calculates expanded trend and volatility indicators with declared outputs", () => {
    const adx = calculateIndicator("adx", frame, { period: 3 });
    expect(Number.isFinite(adx.adx[10])).toBe(true); expect(adx.plus_di[10]).toBeGreaterThan(adx.minus_di[10]);
    const trend = calculateIndicator("supertrend", frame, { period: 3, multiple: 2 });
    expect(Number.isFinite(trend.supertrend[10])).toBe(true); expect([1, -1]).toContain(trend.direction[10]);
    expect(Number.isFinite(calculateIndicator("keltner", frame, { period: 4, atrPeriod: 3, multiple: 2 }).upper[10])).toBe(true);
    expect(Number.isFinite(calculateIndicator("choppiness_index", frame, { period: 5 }).choppiness[10])).toBe(true);
  });
  it("calculates expanded volume, taker-flow, statistical, and calendar features", () => {
    expect(Number.isFinite(calculateIndicator("money_flow_index", frame, { period: 5 }).mfi[10])).toBe(true);
    expect(Number.isFinite(calculateIndicator("chaikin_money_flow", frame, { period: 5 }).cmf[10])).toBe(true);
    expect(calculateIndicator("accumulation_distribution", frame).adl[10]).toBeTypeOf("number");
    expect(calculateIndicator("base_volume_delta", frame).base_volume_delta[10]).toBeCloseTo(0);
    expect(Number.isFinite(calculateIndicator("quote_volume_delta", frame).quote_volume_delta[10])).toBe(true);
    expect(calculateIndicator("consecutive_seller_dominant", frame).consecutive_seller_dominant[10]).toBe(0);
    expect(Number.isFinite(calculateIndicator("return_zscore", frame, { period: 5 }).return_zscore[12])).toBe(true);
    expect(calculateIndicator("month_of_year", frame)["month_of_year"][10]).toBe(1);
    expect(calculateIndicator("is_weekend", frame).is_weekend[0]).toBe(0);
  });
  it("delays swing availability until its future confirmation candles have closed", () => {
    const highs = [100, 102, 110, 103, 101], lows = [90, 91, 92, 91, 90];
    const swings = highs.map((high, index) => candle(Date.UTC(2026, 0, 1, 0, index), { open: "95", high: String(high), low: String(lows[index]), close: "96" }));
    const values = calculateIndicator("swing_high", swings, { period: 2 }).swing_high;
    expect(Number.isNaN(values[2])).toBe(true);
    expect(values[4]).toBe(110);
  });
});
describe("point-in-time multi-timeframe safety", () => {
  it("selects the most recent closed higher-timeframe candle, never a future one", () => {
    const daily = [candle(Date.UTC(2026, 0, 1), { timeframe: "1d", closeTime: new Date(Date.UTC(2026, 0, 1, 23, 59, 59, 999)), close: "100" }), candle(Date.UTC(2026, 0, 2), { timeframe: "1d", closeTime: new Date(Date.UTC(2026, 0, 2, 23, 59, 59, 999)), close: "200" })];
    const source = { verificationRange: (_symbol: string, timeframe: string) => timeframe === "1d" ? daily : frame };
    const engine = new FeatureEngine("BTCUSDT", new Date(Date.UTC(2026,0,1)), new Date(Date.UTC(2026,0,3)), source as any).load(["1m", "1d"]);
    expect(engine.price("close", "1d", new Date(Date.UTC(2026, 0, 2, 12)))).toBe(100);
    expect(engine.price("close", "1d", new Date(Date.UTC(2026, 0, 3)))).toBe(200);
    expect(engine.getLatestClosedCandle("1d", new Date(Date.UTC(2026, 0, 2, 12)))?.close).toBe("100");
    expect(engine.getLatestClosedCandle("1d", new Date(Date.UTC(2025, 11, 31, 23, 59)))).toBeNull();
  });
  it("evaluates nested AND/OR without leaking unavailable warmup features", () => {
    const source = { verificationRange: () => frame };
    const engine = new FeatureEngine("BTCUSDT", frame[0].openTime, frame.at(-1)!.closeTime, source as any).load(["1m"]);
    const at = frame.at(-1)!.closeTime;
    expect(evaluateCondition({ type: "group", operator: "AND", children: [{ left: { type: "indicator", indicator: "ema", parameters: { period: 5 }, timeframe: "1m" }, operator: ">", right: { type: "constant", value: 100 } }, { type: "group", operator: "OR", children: [{ left: { type: "indicator", indicator: "rsi", parameters: { period: 14 }, timeframe: "1m" }, operator: ">", right: { type: "constant", value: 50 } }] }] }, engine, at).passed).toBe(true);
  });
  it("keeps a 15m trigger from reading an open 1h confirmation candle", () => {
    const hourly = [candle(Date.UTC(2026, 0, 1, 0), { timeframe: "1h", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 59, 59, 999)), close: "100" }), candle(Date.UTC(2026, 0, 1, 1), { timeframe: "1h", closeTime: new Date(Date.UTC(2026, 0, 1, 1, 59, 59, 999)), close: "200" })];
    const trigger = [candle(Date.UTC(2026, 0, 1, 0, 45), { timeframe: "15m", closeTime: new Date(Date.UTC(2026, 0, 1, 1, 0)), close: "1" })];
    const source = { verificationRange: (_symbol: string, timeframe: string) => timeframe === "1h" ? hourly : trigger }, engine = new FeatureEngine("BTCUSDT", trigger[0].openTime, trigger[0].closeTime, source as any).load(["15m", "1h"]);
    expect(engine.getLatestClosedCandle("1h", new Date(Date.UTC(2026, 0, 1, 1, 15)))?.close).toBe("100");
    expect(engine.getLatestClosedCandle("1h", new Date(Date.UTC(2026, 0, 1, 2)))?.close).toBe("200");
  });
});
describe("strategy configuration validation", () => {
  it("derives maximum pre-run warm-up per required timeframe", () => {
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "5m", executionTimeframe: "5m", requiredTimeframes: ["5m", "1d"], directions: "LONG_ONLY", longEntry: { type: "group", operator: "AND", children: [{ left: { type: "indicator", indicator: "ema", parameters: { period: 20 }, timeframe: "5m" }, operator: ">", right: { type: "constant", value: 1 } }, { left: { type: "indicator", indicator: "ema", parameters: { period: 50 }, timeframe: "1d" }, operator: ">", right: { type: "constant", value: 1 } }] }, stop: { type: "ATR", timeframe: "5m", period: 14, multiple: 2 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: {} });
    expect(strategyWarmupBars(config)).toEqual({ "5m": 20, "1d": 50 });
  });
  it("validates volatility sizing and includes its ATR requirement in warm-up", () => {
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "5m", executionTimeframe: "5m", requiredTimeframes: ["5m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 2 }, takeProfit: { type: "NONE" }, sizing: { type: "VOLATILITY_BASED", riskPct: 1, timeframe: "5m", atrPeriod: 21, targetAtrMultiple: 1.5 }, leverage: { fixed: 1, maximum: 1 }, costs: {} });
    expect(validateStrategyConfiguration(config)).toEqual([]); expect(strategyWarmupBars(config)["5m"]).toBe(21);
  });
  it("keeps persisted pre-entry-quality versions readable", () => {
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "5m", executionTimeframe: "5m", requiredTimeframes: ["5m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 2 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: {} });
    delete (config as Record<string, unknown>).entryQuality;
    expect(validateStrategyConfiguration(config)).toEqual([]); expect(strategyWarmupBars(config)).toEqual({ "5m": 0 });
  });
  it("diffs nested condition arrays without reporting unchanged siblings", () => {
    const left = { longEntry: { type: "group", operator: "AND", children: [{ left: { type: "constant", value: 1 } }, { left: { type: "constant", value: 2 } }] } };
    const right = { longEntry: { type: "group", operator: "AND", children: [{ left: { type: "constant", value: 1 } }, { left: { type: "constant", value: 3 } }] } };
    expect(configurationDiff(left, right)).toEqual([{ path: "configuration.longEntry.children[1].left.value", left: 2, right: 3 }]);
  });
  it("rejects unknown indicators and timeframes omitted from the point-in-time contract", () => {
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "5m", executionTimeframe: "5m", requiredTimeframes: ["5m"], directions: "LONG_ONLY", longEntry: { left: { type: "indicator", indicator: "not_real", parameters: {}, timeframe: "1h" }, operator: ">", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 1 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: {} });
    expect(validateStrategyConfiguration(config)).toEqual(expect.arrayContaining([expect.stringContaining("timeframe 1h is not required"), expect.stringContaining("Unknown indicator: not_real")]));
  });
  it("rejects execution resolution coarser than the trigger", () => {
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "15m", executionTimeframe: "1h", requiredTimeframes: ["15m", "1h"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 1 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: {} });
    expect(validateStrategyConfiguration(config)).toEqual(expect.arrayContaining([expect.stringContaining("cannot be coarser")]));
  });
});
describe("historical execution", () => {
  it("evaluates a 15m trigger and fills on the next 1m open", async () => {
    const trigger = [candle(Date.UTC(2026, 0, 1, 0, 0), { timeframe: "15m", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 15)), open: "100", high: "101", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 15), { timeframe: "15m", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 30)), open: "100", high: "103", low: "99", close: "102" })];
    const lower = [candle(Date.UTC(2026, 0, 1, 0, 16), { timeframe: "1m", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 17)), open: "101", high: "102", low: "100", close: "101" }), candle(Date.UTC(2026, 0, 1, 0, 17), { timeframe: "1m", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 18)), open: "101", high: "102", low: "100", close: "101" })];
    const source = { verificationRange: (_symbol: string, timeframe: string) => timeframe === "15m" ? trigger : lower }, engine = new FeatureEngine("BTCUSDT", trigger[0].openTime, trigger.at(-1)!.closeTime, source as any).load(["15m", "1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "15m", executionTimeframe: "1m", requiredTimeframes: ["15m", "1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 50 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "NEXT_OPEN", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000);
    expect(result.trades[0].entryTime).toBe(Date.UTC(2026, 0, 1, 0, 16));
  });
  it("caps notional at configured leverage without multiplying fees again", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1), { timeframe: "1m", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 1)), open: "100", high: "100", low: "100", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { timeframe: "1m", closeTime: new Date(Date.UTC(2026, 0, 1, 0, 2)), open: "100", high: "100", low: "100", close: "100" })];
    const source = { verificationRange: () => candles }, engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 1 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_RISK", riskPct: 100 }, leverage: { fixed: 2, maximum: 2 }, costs: { fillModel: "CLOSE", makerFeePct: .02, takerFeePct: .04, slippageBps: 0, fundingMode: "NONE" } });
    const result = await simulate(config, engine, 1000);
    expect(Number(result.trades[0].details.entryNotional)).toBeLessThanOrEqual(2000);
    expect(Number(result.trades[0].details.entryFee)).toBeCloseTo(Number(result.trades[0].details.entryNotional) * .0004);
  });
  it("reports risk-adjusted ratios, streaks and holding statistics from closed balance", () => {
    const trades = [{ side: "LONG", entryTime: 0, exitTime: 3_600_000, entryPrice: "100", exitPrice: "110", quantity: "1", grossPnl: "10", netPnl: "10", fees: "1", returnPct: 10, rMultiple: 1, maePct: -1, mfePct: 12, holdingMs: 3_600_000, entryReason: "CANDLE_CLOSED", exitReason: "TAKE_PROFIT", details: { funding: "1", slippageImpact: "2" } }, { side: "SHORT", entryTime: 7_200_000, exitTime: 10_800_000, entryPrice: "100", exitPrice: "110", quantity: "1", grossPnl: "-10", netPnl: "-10", fees: "1", returnPct: -10, rMultiple: -1, maePct: -12, mfePct: 1, holdingMs: 3_600_000, entryReason: "CANDLE_CLOSED", exitReason: "STOP_LOSS", details: { funding: "-0.5", slippageImpact: "3" } }] as any;
    const metrics = verificationMetrics(trades, [{ time: 0, balance: 100 }, { time: 3_600_000, balance: 110 }, { time: 10_800_000, balance: 100 }]);
    expect(metrics).toMatchObject({ maxConsecutiveWins: 1, maxConsecutiveLosses: 1, medianHoldingMs: 3_600_000, gainToPainRatio: 1, totalFees: 2, totalFunding: .5, totalSlippageImpact: 5 }); expect(metrics.sortino).not.toBeNull(); expect(metrics.ulcerIndex).toBeGreaterThan(0);
  });
  it("moves and executes a percentage trailing stop using only observed candle highs/lows", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1, 0, 0), { open: "100", high: "101", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100", high: "120", low: "110", close: "115" }), candle(Date.UTC(2026, 0, 1, 0, 2), { open: "115", high: "116", low: "107", close: "108" })];
    const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 5 }, takeProfit: { type: "NONE" }, trailing: { type: "PERCENTAGE", percentage: 10 }, sizing: { type: "FIXED_NOTIONAL", notional: 1000 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 10_000); expect(result.trades).toHaveLength(1); expect(result.trades[0]).toMatchObject({ exitReason: "TRAILING_STOP", exitPrice: "108" });
  });
  it("raises a moving-average trailing stop only from the closed candle value", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1, 0, 0), { open: "100", high: "101", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100", high: "120", low: "110", close: "115" }), candle(Date.UTC(2026, 0, 1, 0, 2), { open: "115", high: "116", low: "107", close: "108" })];
    const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 20 }, takeProfit: { type: "NONE" }, trailing: { type: "MOVING_AVERAGE", indicator: "sma", timeframe: "1m", period: 2 }, sizing: { type: "FIXED_NOTIONAL", notional: 1000 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 10_000); expect(result.trades).toHaveLength(1); expect(result.trades[0]).toMatchObject({ exitReason: "TRAILING_STOP", exitPrice: "111.5" });
  });
  it("uses a swing trailing stop only after that swing is confirmed", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1, 0, 0), { open: "100", high: "101", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100", high: "101", low: "98", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 2), { open: "100", high: "101", low: "90", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 3), { open: "100", high: "101", low: "95", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 4), { open: "100", high: "101", low: "96", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 5), { open: "100", high: "101", low: "89", close: "90" })];
    const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 50 }, takeProfit: { type: "NONE" }, trailing: { type: "STRUCTURE", reference: "SWING", lookback: 2 }, sizing: { type: "FIXED_NOTIONAL", notional: 1000 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 10_000); expect(result.trades).toHaveLength(1); expect(result.trades[0]).toMatchObject({ exitReason: "TRAILING_STOP", exitPrice: "90" });
  });
  it("rounds execution sizes and records exchange-rule rejections", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1), { open: "100", high: "101", low: "99", close: "100" })]; const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles[0].closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 1 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 10 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000, undefined, undefined, { tickSize: ".1", stepSize: ".01", minNotional: "100" }); expect(result.trades).toHaveLength(0); expect(result.funnel.exchangeRejected).toBe(1);
  });
  it("rounds fill prices up and quantities down before charging fees", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1), { open: "100.03", high: "100.03", low: "100.03", close: "100.03" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100.03", high: "100.03", low: "100.03", close: "100.03" })]; const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 1 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: .02, takerFeePct: .04, slippageBps: 0, fundingMode: "NONE" } });
    const result = await simulate(config, engine, 1000, undefined, undefined, { tickSize: ".1", stepSize: ".01" });
    expect(result.trades[0]).toMatchObject({ entryPrice: "100.1", quantity: "0.99" });
    expect(Number(result.trades[0].details.entryNotional)).toBeCloseTo(99.099);
  });
  it("rejects an entry whose configured reward does not meet the minimum R/R", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1), { open: "100", high: "101", low: "99", close: "100" })]; const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles[0].closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 10 }, takeProfit: { type: "PERCENTAGE", percentage: 5 }, minimumRiskReward: 1, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades).toHaveLength(0); expect(result.funnel.entryQualityRejected).toBe(1);
  });
  it("rejects entries too far from a declared point-in-time reference", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1), { open: "100", high: "101", low: "99", close: "100" })]; const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles[0].closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 10 }, takeProfit: { type: "NONE" }, entryQuality: { maxDistanceFromReference: { reference: { type: "constant", value: 90 }, maximumPct: 5 } }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades).toHaveLength(0); expect(result.funnel.entryQualityRejected).toBe(1);
  });
  it("applies fixed funding pro-rata to the final P&L and records its convention", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1), { open: "100", high: "100", low: "100", close: "100" }), candle(Date.UTC(2026, 0, 1, 8), { open: "100", high: "100", low: "100", close: "100" })];
    const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 50 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "FIXED", fixedFundingPct: 1, sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades[0].netPnl).toBe("-1.00000000"); expect(result.trades[0].details.funding).toBe("1.00000000"); expect(result.warnings[0]).toContain("Fixed funding approximation");
  });
  it("evaluates configured long exits after intrabar risk controls at candle close", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1, 0, 0), { open: "100", high: "101", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100", high: "103", low: "99", close: "102" })];
    const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, longExit: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 10 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades).toHaveLength(1); expect(result.trades[0]).toMatchObject({ exitReason: "STRATEGY_EXIT", exitPrice: "102" }); expect(result.funnel.exitSignals).toBe(1);
  });
  it("uses independent worst-case entry and signal-exit fill policies", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1, 0, 0), { open: "100", high: "105", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100", high: "110", low: "90", close: "100" })]; const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, longExit: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 50 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", entryFillModel: "WORST_CASE", exitFillModel: "WORST_CASE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades).toHaveLength(1); expect(result.trades[0]).toMatchObject({ entryPrice: "105", exitPrice: "90", exitReason: "STRATEGY_EXIT" }); expect(result.trades[0].details).toMatchObject({ entryFillModel: "WORST_CASE", exitFillModel: "WORST_CASE" });
  });
  it("executes and settles a short position with inverse P&L", async () => {
    const candles = [candle(Date.UTC(2026, 0, 1, 0, 0), { open: "100", high: "101", low: "99", close: "100" }), candle(Date.UTC(2026, 0, 1, 0, 1), { open: "100", high: "100", low: "89", close: "90" })]; const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "SHORT_ONLY", shortEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 50 }, takeProfit: { type: "NONE" }, sizing: { type: "FIXED_NOTIONAL", notional: 100 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades).toHaveLength(1); expect(result.trades[0]).toMatchObject({ side: "SHORT", grossPnl: "10.00000000", exitReason: "END_OF_TEST" });
  });
  it("sizes entries from closed ATR volatility and waits for its warm-up", async () => {
    const candles = Array.from({ length: 8 }, (_, index) => candle(Date.UTC(2026, 0, 1, 0, index), { open: String(100 + index), high: String(102 + index), low: String(99 + index), close: String(101 + index) }));
    const source = { verificationRange: () => candles }; const engine = new FeatureEngine("BTCUSDT", candles[0].openTime, candles.at(-1)!.closeTime, source as any).load(["1m"]);
    const config = strategyConfigSchema.parse({ exchange: "BINANCE", market: "BINANCE_USDM_FUTURES", symbols: ["BTCUSDT"], triggerTimeframe: "1m", executionTimeframe: "1m", requiredTimeframes: ["1m"], directions: "LONG_ONLY", longEntry: { left: { type: "constant", value: 1 }, operator: "==", right: { type: "constant", value: 1 } }, stop: { type: "PERCENTAGE", percentage: 50 }, takeProfit: { type: "NONE" }, sizing: { type: "VOLATILITY_BASED", riskPct: 1, timeframe: "1m", atrPeriod: 3, targetAtrMultiple: 1 }, leverage: { fixed: 1, maximum: 1 }, costs: { fillModel: "CLOSE", makerFeePct: 0, takerFeePct: 0, slippageBps: 0, fundingMode: "NONE", sameBarPolicy: "WORST_CASE" } });
    const result = await simulate(config, engine, 1000); expect(result.trades).toHaveLength(1); expect(Number(result.trades[0].quantity)).toBeGreaterThan(0); expect(result.funnel.rejectedWarmup).toBeGreaterThan(0);
  });
});
