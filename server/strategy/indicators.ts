import type { Candle } from "../domain/candle.js";

export const INDICATOR_REGISTRY_VERSION = "2026.09.semantic.1";
export type IndicatorParameter = { type: "integer" | "number"; default: number; min: number; max: number };
export type IndicatorSemanticType = "PRICE_LEVEL" | "PRICE_DISTANCE" | "PRICE_PERCENTAGE" | "BOUNDED_OSCILLATOR" | "UNBOUNDED_OSCILLATOR" | "NON_NEGATIVE_MAGNITUDE" | "SIGNED_DIRECTIONAL_VALUE" | "RATIO" | "PERCENTAGE" | "BOOLEAN" | "CATEGORICAL_DIRECTION" | "CUMULATIVE_SERIES" | "COUNT" | "VOLUME_LEVEL" | "VOLATILITY_LEVEL" | "NORMALIZED_Z_SCORE" | "CALENDAR_CATEGORY";
export type IndicatorRole = "ENTRY_TRIGGER" | "DIRECTIONAL_FILTER" | "TREND_FILTER" | "VOLATILITY_FILTER" | "VOLUME_CONFIRMATION" | "REGIME_FILTER" | "EXIT_INPUT" | "STOP_DISTANCE_INPUT" | "SIZING_INPUT";
export type IndicatorOperator = ">" | ">=" | "<" | "<=" | "==" | "!=" | "crosses_above" | "crosses_below" | "is_true" | "is_false" | "between" | "outside";
export type IndicatorOutputSemantics = {
  semanticType: IndicatorSemanticType;
  min?: number;
  max?: number;
  canBeNegative: boolean;
  priceScaled: boolean;
  percentageScaled: boolean;
  ratioScaled: boolean;
  directional: boolean;
  categorical: boolean;
  discrete: boolean;
  validOperators: IndicatorOperator[];
  validOperands: ("CONSTANT" | "PRICE_LEVEL" | "COMPATIBLE_SERIES" | "SAME_OUTPUT")[];
  roles: IndicatorRole[];
};
export type IndicatorParameterConstraint = { name: string; description: string; validate: (parameters: Record<string, unknown>) => string | null };
export type IndicatorDefinition = { id: string; name: string; category: string; description: string; requiredFields: string[]; parameters: Record<string, IndicatorParameter>; parameterConstraints: IndicatorParameterConstraint[]; warmupBars: (parameters: Record<string, unknown>) => number; outputs: string[]; outputMetadata: Record<string, IndicatorOutputSemantics>; visualization: "overlay" | "subpanel"; pointInTimeSafe: true; supportedTimeframes: string[]; roles: IndicatorRole[]; templates: string[]; normalization: "NONE" | "PRICE" | "PERCENTAGE" | "RATIO" | "ZSCORE" | "EVENT" };
const frames = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
const period = (defaultValue = 14, max = 300): Record<string, IndicatorParameter> => ({ period: { type: "integer", default: defaultValue, min: 2, max } });

const operators = (semanticType: IndicatorSemanticType): IndicatorOperator[] => {
  if (["BOOLEAN"].includes(semanticType)) return ["is_true", "is_false", "==", "!="];
  if (["CATEGORICAL_DIRECTION", "CALENDAR_CATEGORY"].includes(semanticType)) return ["==", "!=", "crosses_above", "crosses_below", "between", "outside"];
  if (["PRICE_LEVEL"].includes(semanticType)) return [">", ">=", "<", "<=", "crosses_above", "crosses_below", "==", "between", "outside"];
  if (["NON_NEGATIVE_MAGNITUDE", "VOLUME_LEVEL", "VOLATILITY_LEVEL", "COUNT"].includes(semanticType)) return [">", ">=", "crosses_above", "crosses_below", "between", "outside"];
  if (["CUMULATIVE_SERIES"].includes(semanticType)) return ["crosses_above", "crosses_below", ">", "<", "between", "outside"];
  return [">", ">=", "<", "<=", "crosses_above", "crosses_below", "==", "between", "outside"];
};
const semantic = (semanticType: IndicatorSemanticType, options: Partial<IndicatorOutputSemantics> = {}): IndicatorOutputSemantics => ({
  semanticType,
  canBeNegative: options.canBeNegative ?? (options.min != null && options.min >= 0 ? false : !["PRICE_LEVEL", "NON_NEGATIVE_MAGNITUDE", "VOLUME_LEVEL", "VOLATILITY_LEVEL", "COUNT", "RATIO", "PERCENTAGE", "BOOLEAN", "CALENDAR_CATEGORY"].includes(semanticType)),
  priceScaled: semanticType === "PRICE_LEVEL" || semanticType === "PRICE_DISTANCE",
  percentageScaled: semanticType === "PRICE_PERCENTAGE" || semanticType === "PERCENTAGE",
  ratioScaled: semanticType === "RATIO",
  directional: ["SIGNED_DIRECTIONAL_VALUE", "CATEGORICAL_DIRECTION"].includes(semanticType),
  categorical: ["BOOLEAN", "CATEGORICAL_DIRECTION", "CALENDAR_CATEGORY"].includes(semanticType),
  discrete: ["BOOLEAN", "CATEGORICAL_DIRECTION", "COUNT", "CALENDAR_CATEGORY"].includes(semanticType),
  validOperators: operators(semanticType),
  validOperands: semanticType === "PRICE_LEVEL" ? ["CONSTANT", "PRICE_LEVEL", "COMPATIBLE_SERIES"] : ["CONSTANT", "COMPATIBLE_SERIES", "SAME_OUTPUT"],
  roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER"],
  ...options,
});

const outputSemantics = (id: string, output: string): IndicatorOutputSemantics => {
  if (output === "direction") return semantic("CATEGORICAL_DIRECTION", { min: -1, max: 1, roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "TREND_FILTER"] });
  if (output === "adx") return semantic("NON_NEGATIVE_MAGNITUDE", { min: 0, roles: ["TREND_FILTER", "REGIME_FILTER"] });
  if (["plus_di", "minus_di"].includes(output)) return semantic("BOUNDED_OSCILLATOR", { min: 0, max: 100, directional: true, roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "TREND_FILTER"] });
  if (["macd", "signal", "histogram"].includes(output)) return semantic("SIGNED_DIRECTIONAL_VALUE", { roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "TREND_FILTER"] });
  if (output === "percent_b") return semantic("RATIO", { roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "REGIME_FILTER"] });
  if (output === "width") return semantic("RATIO", { min: 0, roles: ["VOLATILITY_FILTER", "REGIME_FILTER"] });
  if (["sma", "ema", "wma", "vwma", "supertrend", "middle", "upper", "lower", "highest_high", "lowest_low", "donchian", "swing_high", "swing_low"].includes(output) || ["sma", "ema", "wma", "vwma", "supertrend", "bollinger", "keltner", "highest_high", "lowest_low", "donchian", "swing_high", "swing_low"].includes(id)) return semantic("PRICE_LEVEL", { roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "TREND_FILTER", "EXIT_INPUT", "STOP_DISTANCE_INPUT"] });
  if (["rsi", "stochastic_k", "stochastic_rsi", "mfi"].includes(output)) return semantic("BOUNDED_OSCILLATOR", { min: 0, max: 100, directional: true, roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "REGIME_FILTER"] });
  if (output === "williams_r") return semantic("BOUNDED_OSCILLATOR", { min: -100, max: 0, canBeNegative: true, directional: true, roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "REGIME_FILTER"] });
  if (["percentile_rank", "volatility_percentile"].includes(output)) return semantic("BOUNDED_OSCILLATOR", { min: 0, max: 100, roles: ["DIRECTIONAL_FILTER", "VOLATILITY_FILTER", "REGIME_FILTER"] });
  if (output === "choppiness") return semantic("BOUNDED_OSCILLATOR", { min: 0, max: 100, roles: ["REGIME_FILTER", "VOLATILITY_FILTER"] });
  if (["body_to_range", "close_position", "taker_buy_ratio", "taker_sell_ratio"].includes(output)) return semantic(output === "body_to_range" || output === "close_position" ? "RATIO" : "RATIO", { min: 0, max: 1, roles: ["DIRECTIONAL_FILTER", "VOLUME_CONFIRMATION", "ENTRY_TRIGGER"] });
  if (["relative_volume", "relative_quote_volume", "relative_trade_count"].includes(output)) return semantic("RATIO", { min: 0, roles: ["VOLUME_CONFIRMATION", "REGIME_FILTER"] });
  if (["volume_zscore", "quote_volume_zscore", "trade_count_zscore", "delta_zscore", "return_zscore", "price_zscore"].includes(output)) return semantic("NORMALIZED_Z_SCORE", { canBeNegative: true, directional: true, roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "REGIME_FILTER"] });
  if (["atr", "true_range", "stddev", "historical_volatility", "range", "upper_wick", "lower_wick", "body_size", "average_trade_size", "average_trade_notional", "volume_sma", "quote_volume_sma", "consecutive_buyer_dominant", "consecutive_seller_dominant"].includes(output)) return semantic(output.includes("volume") || output.includes("trade") ? "VOLUME_LEVEL" : "NON_NEGATIVE_MAGNITUDE", { roles: ["VOLATILITY_FILTER", "VOLUME_CONFIRMATION", "STOP_DISTANCE_INPUT", "SIZING_INPUT"] });
  if (output === "atr_percent") return semantic("PRICE_PERCENTAGE", { min: 0, roles: ["VOLATILITY_FILTER", "STOP_DISTANCE_INPUT", "SIZING_INPUT"] });
  if (["breakout_up", "breakout_down", "inside_bar", "outside_bar", "is_weekend", "is_month_start", "is_month_end"].includes(output)) return semantic("BOOLEAN", { min: 0, max: 1, directional: true, roles: ["ENTRY_TRIGGER", "REGIME_FILTER", "DIRECTIONAL_FILTER"] });
  if (["hour_utc", "day_of_week", "month_of_year", "quarter_of_year", "week_of_year"].includes(output)) return semantic("CALENDAR_CATEGORY", { min: output === "hour_utc" ? 0 : output === "day_of_week" ? 0 : 1, max: output === "hour_utc" ? 23 : output === "day_of_week" ? 6 : output === "month_of_year" ? 12 : output === "quarter_of_year" ? 4 : 53, roles: ["REGIME_FILTER", "ENTRY_TRIGGER"] });
  if (output === "bars_since_breakout") return semantic("COUNT", { min: 0, roles: ["REGIME_FILTER", "ENTRY_TRIGGER"] });
  if (["obv", "adl", "vpt", "cvd"].includes(output)) return semantic("CUMULATIVE_SERIES", { directional: true, roles: ["DIRECTIONAL_FILTER", "VOLUME_CONFIRMATION", "REGIME_FILTER"] });
  if (["distance_pct", "extension_atr", "ma_slope_pct", "return", "log_return", "mean_return", "median_return", "cci", "roc", "slope", "momentum", "cmf", "relative_base_delta", "base_volume_delta", "quote_volume_delta", "relative_quote_delta", "delta_ema", "autocorrelation", "drawdown"].includes(output)) return semantic("SIGNED_DIRECTIONAL_VALUE", { roles: ["ENTRY_TRIGGER", "DIRECTIONAL_FILTER", "REGIME_FILTER"] });
  return semantic("UNBOUNDED_OSCILLATOR");
};
const roleFor = (outputs: string[]) => [...new Set(outputs.flatMap((output) => outputSemantics("", output).roles))];
const templatesFor = (id: string, outputs: string[]) => [...new Set(outputs.flatMap((output) => {
  const type = outputSemantics(id, output).semanticType;
  if (id === "rsi") return ["RSI_MOMENTUM_THRESHOLD", "RSI_MEAN_REVERSION_CROSS"];
  if (id === "stochastic" || id === "stochastic_rsi") return ["STOCHASTIC_THRESHOLD_CROSS"];
  if (id === "cci") return ["CCI_ZERO_EXTREME_CROSS"];
  if (id === "roc") return ["ROC_ZERO_CROSS"];
  if (["sma", "ema", "wma", "vwma"].includes(id)) return ["PRICE_ABOVE_BELOW_MA", "PRICE_MA_CROSSOVER"];
  if (id === "moving_average_alignment") return ["FAST_SLOW_MA_CROSS"];
  if (id === "macd") return output === "histogram" ? ["MACD_HISTOGRAM_ZERO_CROSS"] : ["MACD_LINE_SIGNAL_CROSS"];
  if (id === "adx") return output === "adx" ? ["ADX_TREND_STRENGTH_FILTER", "DMI_DIRECTIONAL_CROSS"] : ["DMI_DIRECTIONAL_CROSS"];
  if (id === "donchian_breakout" || id === "donchian") return ["DONCHIAN_BREAKOUT"];
  if (id === "bollinger") return [output === "middle" || output === "upper" || output === "lower" ? "BOLLINGER_BREAKOUT" : "BOLLINGER_REENTRY"];
  if (id === "supertrend") return output === "direction" ? ["SUPERTREND_DIRECTION_CHANGE"] : ["PRICE_SUPERTREND_CROSS"];
  if (["relative_volume", "relative_quote_volume", "relative_trade_count"].includes(id) || ["relative_volume", "relative_quote_volume", "relative_trade_count"].includes(output)) return ["RELATIVE_VOLUME_CONFIRMATION", "RELATIVE_VOLUME_TRIGGER", "VOLUME_EXPANSION_CONFIRMATION"];
  if (id === "atr" || id === "atr_percent" || type === "VOLATILITY_LEVEL" || type === "PRICE_PERCENTAGE") return ["ATR_VOLATILITY_REGIME_FILTER"];
  if (type === "BOOLEAN") return ["BOOLEAN_EVENT"];
  if (type === "CALENDAR_CATEGORY") return ["CALENDAR_MEMBERSHIP_FILTER"];
  if (type === "CATEGORICAL_DIRECTION") return ["CATEGORICAL_STATE"];
  if (type === "BOUNDED_OSCILLATOR") return ["BOUNDED_THRESHOLD"];
  if (type === "PRICE_LEVEL") return ["PRICE_ABOVE_BELOW_MA", "PRICE_MA_CROSSOVER"];
  if (type === "RATIO" || type === "PERCENTAGE") return ["NORMALIZED_FILTER"];
  if (["NON_NEGATIVE_MAGNITUDE", "VOLUME_LEVEL", "COUNT"].includes(type)) return ["MAGNITUDE_FILTER"];
  if (["CUMULATIVE_SERIES", "SIGNED_DIRECTIONAL_VALUE", "NORMALIZED_Z_SCORE"].includes(type)) return ["SIGNED_SERIES_CROSS"];
  if (["UNBOUNDED_OSCILLATOR", "PRICE_DISTANCE", "PRICE_PERCENTAGE"].includes(type)) return ["UNBOUNDED_THRESHOLD"];
  throw new Error(`UNREGISTERED_SEMANTIC_TEMPLATE:${id}.${output}:${type}`);
}))];
const constraintsFor = (id: string): IndicatorParameterConstraint[] => {
  const constraints: IndicatorParameterConstraint[] = [];
  if (id === "macd") constraints.push({ name: "fast_lt_slow", description: "MACD fast period must be lower than slow period", validate: (p) => Number(p.fast) < Number(p.slow) ? null : "fast period must be lower than slow period" });
  if (id === "moving_average_alignment") constraints.push({ name: "ordered_periods", description: "Moving-average periods must be fast < medium < slow", validate: (p) => Number(p.fast) < Number(p.medium) && Number(p.medium) < Number(p.slow) ? null : "periods must satisfy fast < medium < slow" });
  if (id === "bollinger") constraints.push({ name: "sensible_deviations", description: "Bollinger deviations must stay between 1 and 4", validate: (p) => Number(p.deviations) >= 1 && Number(p.deviations) <= 4 ? null : "deviations must be between 1 and 4" });
  return constraints;
};
const definition = (id: string, name: string, category: string, fields: string[], outputs: string[], visualization: "overlay" | "subpanel", parameters = period(), warmup = (p: Record<string, unknown>) => Number(p.period ?? 14)): IndicatorDefinition => {
  const outputMetadata = Object.fromEntries(outputs.map((output) => [output, outputSemantics(id, output)]));
  return { id, name, category, description: `${name}, calculated only from closed candles available at the evaluation timestamp.`, requiredFields: fields, parameters, parameterConstraints: constraintsFor(id), warmupBars: warmup, outputs, outputMetadata, visualization, pointInTimeSafe: true, supportedTimeframes: frames, roles: roleFor(outputs), templates: templatesFor(id, outputs), normalization: outputMetadata[outputs[0]]?.semanticType === "PRICE_LEVEL" ? "PRICE" : outputMetadata[outputs[0]]?.semanticType === "NORMALIZED_Z_SCORE" ? "ZSCORE" : outputMetadata[outputs[0]]?.semanticType === "RATIO" ? "RATIO" : outputMetadata[outputs[0]]?.semanticType === "BOOLEAN" ? "EVENT" : "NONE" };
};

export const indicatorRegistry: Record<string, IndicatorDefinition> = Object.fromEntries([
  definition("sma", "Simple Moving Average", "trend", ["close"], ["sma"], "overlay"),
  definition("ema", "Exponential Moving Average", "trend", ["close"], ["ema"], "overlay"),
  definition("wma", "Weighted Moving Average", "trend", ["close"], ["wma"], "overlay"),
  definition("vwma", "Volume Weighted Moving Average", "trend", ["close", "volume"], ["vwma"], "overlay"),
  definition("macd", "MACD", "trend", ["close"], ["macd", "signal", "histogram"], "subpanel", { fast: { type: "integer", default: 12, min: 2, max: 500 }, slow: { type: "integer", default: 26, min: 3, max: 500 }, signal: { type: "integer", default: 9, min: 2, max: 500 } }, (p) => Number(p.slow ?? 26) + Number(p.signal ?? 9)),
  definition("adx", "Average Directional Index", "trend", ["high", "low", "close"], ["adx", "plus_di", "minus_di"], "subpanel"),
  definition("supertrend", "Supertrend", "trend", ["high", "low", "close"], ["supertrend", "direction"], "overlay", { period: { type: "integer", default: 10, min: 2, max: 500 }, multiple: { type: "number", default: 3, min: .1, max: 20 } }, (p) => Number(p.period ?? 10)),
  definition("linear_regression_slope", "Linear Regression Slope", "trend", ["close"], ["slope"], "subpanel"),
  definition("price_distance_ma", "Price Distance from MA", "trend", ["close"], ["distance_pct"], "subpanel"),
  definition("moving_average_slope", "Moving Average Slope", "trend", ["close"], ["ma_slope_pct"], "subpanel", { period: { type: "integer", default: 20, min: 2, max: 500 }, slopePeriod: { type: "integer", default: 5, min: 1, max: 500 } }, (p) => Number(p.period ?? 20) + Number(p.slopePeriod ?? 5)),
  definition("moving_average_alignment", "Moving Average Alignment", "trend", ["close"], ["alignment"], "subpanel", { fast: { type: "integer", default: 20, min: 2, max: 500 }, medium: { type: "integer", default: 50, min: 2, max: 500 }, slow: { type: "integer", default: 200, min: 2, max: 500 } }, (p) => Math.max(Number(p.fast ?? 20), Number(p.medium ?? 50), Number(p.slow ?? 200))),
  definition("rsi", "Relative Strength Index", "momentum", ["close"], ["rsi"], "subpanel"),
  definition("stochastic", "Stochastic Oscillator", "momentum", ["high", "low", "close"], ["stochastic_k"], "subpanel"),
  definition("stochastic_rsi", "Stochastic RSI", "momentum", ["close"], ["stochastic_rsi"], "subpanel", { rsiPeriod: { type: "integer", default: 14, min: 2, max: 500 }, period: { type: "integer", default: 14, min: 2, max: 500 } }, (p) => Number(p.rsiPeriod ?? 14) + Number(p.period ?? 14)),
  definition("williams_r", "Williams %R", "momentum", ["high", "low", "close"], ["williams_r"], "subpanel"),
  definition("cci", "Commodity Channel Index", "momentum", ["high", "low", "close"], ["cci"], "subpanel"),
  definition("roc", "Rate of Change", "momentum", ["close"], ["roc"], "subpanel"),
  definition("momentum", "Momentum", "momentum", ["close"], ["momentum"], "subpanel"),
  definition("true_range", "True Range", "volatility", ["high", "low", "close"], ["true_range"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("atr", "Average True Range", "volatility", ["high", "low", "close"], ["atr"], "subpanel"),
  definition("atr_percent", "ATR Percentage", "volatility", ["high", "low", "close"], ["atr_percent"], "subpanel"),
  definition("bollinger", "Bollinger Bands", "volatility", ["close"], ["middle", "upper", "lower", "width", "percent_b"], "overlay", { period: { type: "integer", default: 20, min: 2, max: 500 }, deviations: { type: "number", default: 2, min: 0.1, max: 10 } }),
  definition("rolling_stddev", "Rolling Standard Deviation", "volatility", ["close"], ["stddev"], "subpanel"),
  definition("historical_volatility", "Historical Volatility", "volatility", ["close"], ["historical_volatility"], "subpanel"),
  definition("keltner", "Keltner Channels", "volatility", ["high", "low", "close"], ["middle", "upper", "lower"], "overlay", { period: { type: "integer", default: 20, min: 2, max: 500 }, atrPeriod: { type: "integer", default: 10, min: 2, max: 500 }, multiple: { type: "number", default: 2, min: .1, max: 20 } }, (p) => Math.max(Number(p.period ?? 20), Number(p.atrPeriod ?? 10))),
  definition("choppiness_index", "Choppiness Index", "volatility", ["high", "low", "close"], ["choppiness"], "subpanel"),
  definition("volatility_percentile", "Volatility Percentile", "volatility", ["close"], ["volatility_percentile"], "subpanel", { period: { type: "integer", default: 20, min: 2, max: 500 }, rankPeriod: { type: "integer", default: 100, min: 2, max: 1000 } }, (p) => Number(p.period ?? 20) + Number(p.rankPeriod ?? 100)),
  definition("volume_sma", "Volume SMA", "volume", ["volume"], ["volume_sma"], "subpanel"),
  definition("relative_volume", "Relative Volume", "volume", ["volume"], ["relative_volume"], "subpanel"),
  definition("volume_zscore", "Volume Z-score", "volume", ["volume"], ["volume_zscore"], "subpanel"),
  definition("quote_volume_sma", "Quote Volume SMA", "volume", ["quote_volume"], ["quote_volume_sma"], "subpanel"),
  definition("relative_quote_volume", "Relative Quote Volume", "volume", ["quote_volume"], ["relative_quote_volume"], "subpanel"),
  definition("quote_volume_zscore", "Quote Volume Z-score", "volume", ["quote_volume"], ["quote_volume_zscore"], "subpanel"),
  definition("average_trade_size", "Average Trade Size", "volume", ["volume", "trade_count"], ["average_trade_size"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("obv", "On-Balance Volume", "volume", ["close", "volume"], ["obv"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("money_flow_index", "Money Flow Index", "volume", ["high", "low", "close", "volume"], ["mfi"], "subpanel"),
  definition("chaikin_money_flow", "Chaikin Money Flow", "volume", ["high", "low", "close", "volume"], ["cmf"], "subpanel"),
  definition("accumulation_distribution", "Accumulation Distribution Line", "volume", ["high", "low", "close", "volume"], ["adl"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("volume_price_trend", "Volume Price Trend", "volume", ["close", "volume"], ["vpt"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("average_trade_notional", "Average Trade Notional", "volume", ["quote_volume", "trade_count"], ["average_trade_notional"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("relative_trade_count", "Relative Trade Count", "volume", ["trade_count"], ["relative_trade_count"], "subpanel"),
  definition("trade_count_zscore", "Trade Count Z-score", "volume", ["trade_count"], ["trade_count_zscore"], "subpanel"),
  definition("taker_buy_ratio", "Taker Buy Ratio", "taker_flow", ["volume", "taker_buy_base_volume"], ["taker_buy_ratio"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("taker_sell_ratio", "Taker Sell Ratio", "taker_flow", ["volume", "taker_buy_base_volume"], ["taker_sell_ratio"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("relative_base_delta", "Relative Base Delta", "taker_flow", ["volume", "taker_buy_base_volume"], ["relative_base_delta"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("base_volume_delta", "Base Volume Delta", "taker_flow", ["volume", "taker_buy_base_volume"], ["base_volume_delta"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("quote_volume_delta", "Quote Volume Delta", "taker_flow", ["quote_volume", "taker_buy_quote_volume"], ["quote_volume_delta"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("relative_quote_delta", "Relative Quote Delta", "taker_flow", ["quote_volume", "taker_buy_quote_volume"], ["relative_quote_delta"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("cumulative_volume_delta", "Cumulative Volume Delta", "taker_flow", ["volume", "taker_buy_base_volume"], ["cvd"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("delta_ema", "Base Delta EMA", "taker_flow", ["volume", "taker_buy_base_volume"], ["delta_ema"], "subpanel"),
  definition("delta_zscore", "Base Delta Z-score", "taker_flow", ["volume", "taker_buy_base_volume"], ["delta_zscore"], "subpanel"),
  definition("taker_buy_ratio_ema", "Taker Buy Ratio EMA", "taker_flow", ["volume", "taker_buy_base_volume"], ["taker_buy_ratio_ema"], "subpanel"),
  definition("consecutive_buyer_dominant", "Consecutive Buyer-Dominant Candles", "taker_flow", ["volume", "taker_buy_base_volume"], ["consecutive_buyer_dominant"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("consecutive_seller_dominant", "Consecutive Seller-Dominant Candles", "taker_flow", ["volume", "taker_buy_base_volume"], ["consecutive_seller_dominant"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("highest_high", "Highest High", "structure", ["high"], ["highest_high"], "overlay"),
  definition("lowest_low", "Lowest Low", "structure", ["low"], ["lowest_low"], "overlay"),
  definition("donchian", "Donchian Channels", "structure", ["high", "low"], ["upper", "lower", "middle"], "overlay"),
  definition("swing_high", "Confirmed Swing High", "structure", ["high"], ["swing_high"], "overlay", period(), (p) => Number(p.period ?? 14) * 2 + 1),
  definition("swing_low", "Confirmed Swing Low", "structure", ["low"], ["swing_low"], "overlay", period(), (p) => Number(p.period ?? 14) * 2 + 1),
  definition("donchian_breakout", "Donchian Breakout", "structure", ["high", "low", "close"], ["breakout_up", "breakout_down"], "subpanel"),
  definition("breakout_age", "Breakout Age", "structure", ["high", "low", "close"], ["bars_since_breakout"], "subpanel"),
  definition("distance_to_recent_high", "Distance to Recent High", "structure", ["high", "close"], ["distance_pct"], "subpanel"),
  definition("distance_to_recent_low", "Distance to Recent Low", "structure", ["low", "close"], ["distance_pct"], "subpanel"),
  definition("price_extension_atr", "Price Extension from EMA in ATR", "structure", ["high", "low", "close"], ["extension_atr"], "subpanel", { emaPeriod: { type: "integer", default: 20, min: 2, max: 500 }, atrPeriod: { type: "integer", default: 14, min: 2, max: 500 } }, (p) => Math.max(Number(p.emaPeriod ?? 20), Number(p.atrPeriod ?? 14))),
  definition("inside_bar", "Inside Bar", "structure", ["high", "low"], ["inside_bar"], "subpanel", {} as Record<string, IndicatorParameter>, () => 2),
  definition("outside_bar", "Outside Bar", "structure", ["high", "low"], ["outside_bar"], "subpanel", {} as Record<string, IndicatorParameter>, () => 2),
  definition("candle_body_size", "Candle Body Size", "structure", ["open", "close"], ["body_size"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("candle_range", "Candle Range", "structure", ["high", "low"], ["range"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("upper_wick_size", "Upper Wick Size", "structure", ["open", "high", "close"], ["upper_wick"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("lower_wick_size", "Lower Wick Size", "structure", ["open", "low", "close"], ["lower_wick"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("candle_body_ratio", "Candle Body-to-Range", "structure", ["open", "high", "low", "close"], ["body_to_range"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("close_position_in_range", "Close Position in Candle Range", "structure", ["high", "low", "close"], ["close_position"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("simple_return", "Simple Return", "statistical", ["close"], ["return"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("log_return", "Log Return", "statistical", ["close"], ["log_return"], "subpanel", {} as Record<string, IndicatorParameter>, () => 1),
  definition("rolling_mean_return", "Rolling Mean Return", "statistical", ["close"], ["mean_return"], "subpanel"),
  definition("rolling_median_return", "Rolling Median Return", "statistical", ["close"], ["median_return"], "subpanel"),
  definition("return_zscore", "Return Z-score", "statistical", ["close"], ["return_zscore"], "subpanel"),
  definition("percentile_rank", "Percentile Rank", "statistical", ["close"], ["percentile_rank"], "subpanel"),
  definition("rolling_skewness", "Rolling Skewness", "statistical", ["close"], ["skewness"], "subpanel"),
  definition("rolling_kurtosis", "Rolling Kurtosis", "statistical", ["close"], ["kurtosis"], "subpanel"),
  definition("rolling_autocorrelation", "Rolling Autocorrelation", "statistical", ["close"], ["autocorrelation"], "subpanel"),
  definition("price_zscore", "Price Z-score", "statistical", ["close"], ["price_zscore"], "subpanel"),
  definition("rolling_drawdown", "Rolling Drawdown", "statistical", ["close"], ["drawdown"], "subpanel"),
  definition("hour_utc", "Hour UTC", "calendar", [], ["hour_utc"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("day_of_week", "Day of Week UTC", "calendar", [], ["day_of_week"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("month_of_year", "Month of Year UTC", "calendar", [], ["month_of_year"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("quarter_of_year", "Quarter of Year UTC", "calendar", [], ["quarter_of_year"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("week_of_year", "Week of Year UTC", "calendar", [], ["week_of_year"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("is_weekend", "Weekend UTC", "calendar", [], ["is_weekend"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("is_month_start", "Month Start UTC", "calendar", [], ["is_month_start"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
  definition("is_month_end", "Month End UTC", "calendar", [], ["is_month_end"], "subpanel", {} as Record<string, IndicatorParameter>, () => 0),
].map((d) => [d.id, d]));

// Parameter ranges are deliberately indicator-specific. This prevents a generic
// 2..500 sampler from creating warm-up-heavy or semantically meaningless rules.
const parameterOverrides: Record<string, Record<string, IndicatorParameter>> = {
  sma: period(20, 200), ema: period(20, 200), wma: period(20, 200), vwma: period(20, 200), linear_regression_slope: period(20, 100), money_flow_index: period(14, 100), chaikin_money_flow: period(14, 100), macd: { fast: { type: "integer", default: 12, min: 2, max: 100 }, slow: { type: "integer", default: 26, min: 5, max: 300 }, signal: { type: "integer", default: 9, min: 2, max: 50 } }, supertrend: { period: { type: "integer", default: 10, min: 2, max: 100 }, multiple: { type: "number", default: 3, min: .5, max: 8 } },
  rsi: period(14, 50), stochastic: period(14, 50), stochastic_rsi: { rsiPeriod: { type: "integer", default: 14, min: 2, max: 50 }, period: { type: "integer", default: 14, min: 2, max: 50 } }, williams_r: period(14, 50), cci: period(20, 100), roc: period(12, 100), momentum: period(10, 100),
  adx: period(14, 100), atr: period(14, 100), atr_percent: period(14, 100), true_range: {}, bollinger: { period: { type: "integer", default: 20, min: 2, max: 100 }, deviations: { type: "number", default: 2, min: 0.1, max: 4 } }, keltner: { period: { type: "integer", default: 20, min: 2, max: 100 }, atrPeriod: { type: "integer", default: 10, min: 2, max: 100 }, multiple: { type: "number", default: 2, min: .1, max: 8 } }, choppiness_index: period(14, 100), rolling_stddev: period(20, 100), historical_volatility: period(20, 100), volatility_percentile: { period: { type: "integer", default: 20, min: 5, max: 100 }, rankPeriod: { type: "integer", default: 100, min: 20, max: 250 } },
  volume_sma: period(20, 100), relative_volume: period(20, 100), volume_zscore: period(20, 100), quote_volume_sma: period(20, 100), relative_quote_volume: period(20, 100), quote_volume_zscore: period(20, 100), relative_trade_count: period(20, 100), trade_count_zscore: period(20, 100), delta_ema: period(20, 100), delta_zscore: period(20, 100), taker_buy_ratio_ema: period(20, 100),
  moving_average_slope: { period: { type: "integer", default: 20, min: 5, max: 100 }, slopePeriod: { type: "integer", default: 5, min: 2, max: 30 } }, moving_average_alignment: { fast: { type: "integer", default: 20, min: 3, max: 80 }, medium: { type: "integer", default: 50, min: 10, max: 150 }, slow: { type: "integer", default: 200, min: 30, max: 300 } }, price_distance_ma: period(20, 100),
  highest_high: period(20, 100), lowest_low: period(20, 100), donchian: period(20, 100), donchian_breakout: period(20, 100), breakout_age: period(20, 100), distance_to_recent_high: period(20, 100), distance_to_recent_low: period(20, 100), swing_high: period(14, 50), swing_low: period(14, 50), price_extension_atr: { emaPeriod: { type: "integer", default: 20, min: 5, max: 100 }, atrPeriod: { type: "integer", default: 14, min: 5, max: 100 } },
  rolling_mean_return: period(20, 100), rolling_median_return: period(20, 100), return_zscore: period(20, 100), percentile_rank: period(50, 250), rolling_skewness: period(30, 150), rolling_kurtosis: period(30, 150), rolling_autocorrelation: period(30, 150), price_zscore: period(20, 100), rolling_drawdown: period(20, 100),
};
for (const [id, parameters] of Object.entries(parameterOverrides)) if (indicatorRegistry[id]) indicatorRegistry[id].parameters = parameters;

export function indicatorOutputSemantics(indicator: string, output?: string): IndicatorOutputSemantics {
  const definition = indicatorRegistry[indicator];
  if (!definition) throw new Error(`Unknown indicator: ${indicator}`);
  const selected = output ?? definition.outputs[0];
  const semantics = definition.outputMetadata[selected];
  if (!semantics) throw new Error(`${indicator} has no output ${selected}`);
  return semantics;
}

export function validateIndicatorRegistry(registry: Record<string, IndicatorDefinition> = indicatorRegistry): string[] {
  const errors: string[] = [];
  for (const [id, definition] of Object.entries(registry)) {
    if (definition.id !== id) errors.push(`${id}: stable id does not match registry key`);
    if (!definition.outputs.length) errors.push(`${id}: at least one output is required`);
    if (!definition.templates.length) errors.push(`${id}: at least one generation template is required`);
    if (!definition.outputMetadata || definition.outputs.some((output) => !definition.outputMetadata[output])) errors.push(`${id}: every output requires semantic metadata`);
    for (const [name, parameter] of Object.entries(definition.parameters)) {
      if (!Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || parameter.min > parameter.max || parameter.default < parameter.min || parameter.default > parameter.max) errors.push(`${id}.${name}: invalid parameter range`);
      if (parameter.type === "integer" && !Number.isInteger(parameter.default)) errors.push(`${id}.${name}: integer default is not an integer`);
    }
    for (const output of definition.outputs) {
      const metadata = definition.outputMetadata[output];
      if (metadata && metadata.semanticType === "BOUNDED_OSCILLATOR" && (metadata.min == null || metadata.max == null)) errors.push(`${id}.${output}: bounded output requires min/max`);
      if (metadata && !metadata.validOperators.length) errors.push(`${id}.${output}: valid operators are required`);
    }
  }
  return errors;
}

const registryErrors = validateIndicatorRegistry();
if (registryErrors.length) throw new Error(`Invalid indicator registry: ${registryErrors.join("; ")}`);

export type FeatureSeries = Record<string, Float64Array>;
const n = (v: string) => Number(v);
const nan = (length: number) => new Float64Array(Array.from({ length }, () => Number.NaN));
const close = (cs: Candle[]) => Float64Array.from(cs, (c) => n(c.close));
const high = (cs: Candle[]) => Float64Array.from(cs, (c) => n(c.high));
const low = (cs: Candle[]) => Float64Array.from(cs, (c) => n(c.low));
const volume = (cs: Candle[]) => Float64Array.from(cs, (c) => n(c.volume));
const quoteVolume = (cs: Candle[]) => Float64Array.from(cs, (c) => n(c.quoteVolume));
const tradeCount = (cs: Candle[]) => Float64Array.from(cs, (c) => c.tradeCount);
function rolling(values: Float64Array, p: number, mapper: (slice: number[]) => number) { const out = nan(values.length); for (let i = p - 1; i < values.length; i++) out[i] = mapper(Array.from(values.slice(i - p + 1, i + 1))); return out; }
function ema(values: Float64Array, p: number) { const out = nan(values.length), alpha = 2 / (p + 1); let start = 0; while (start < values.length && !Number.isFinite(values[start])) start++; if (start + p > values.length) return out; let current = Array.from(values.slice(start, start + p)).reduce((a, b) => a + b, 0) / p; out[start + p - 1] = current; for (let i = start + p; i < values.length; i++) { if (!Number.isFinite(values[i])) continue; current = values[i] * alpha + current * (1 - alpha); out[i] = current; } return out; }
function std(values: number[]) { const mean = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length); }
function trueRange(cs: Candle[]) { const out = nan(cs.length); for (let i = 0; i < cs.length; i++) { const h = n(cs[i].high), l = n(cs[i].low), prev = i ? n(cs[i - 1].close) : h; out[i] = Math.max(h - l, Math.abs(h - prev), Math.abs(l - prev)); } return out; }
function wilder(values: Float64Array, p: number) { const out = nan(values.length); let start = 0; while (start < values.length && !Number.isFinite(values[start])) start++; if (start + p > values.length) return out; let current = Array.from(values.slice(start, start + p)).reduce((a, b) => a + b, 0) / p; out[start + p - 1] = current; for (let i = start + p; i < values.length; i++) { if (!Number.isFinite(values[i])) continue; out[i] = current = (current * (p - 1) + values[i]) / p; } return out; }
function cumulative(values: Float64Array) { const out = nan(values.length); let total = 0; for (let i = 0; i < values.length; i++) out[i] = total += values[i]; return out; }
function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / values.length; }
function median(values: number[]) { const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2; }
function returns(values: Float64Array) { return Float64Array.from(values, (x, i) => i ? x / values[i - 1] - 1 : NaN); }
function rollingRank(values: Float64Array, p: number) { return rolling(values, p, (slice) => { const value = slice.at(-1)!; return slice.filter((x) => x <= value).length / slice.length * 100; }); }

export function validateIndicator(id: string, parameters: Record<string, unknown> = {}) {
  const item = indicatorRegistry[id];
  if (!item) throw new Error(`Unknown indicator: ${id}`);
  for (const [name, schema] of Object.entries(item.parameters)) {
    const value = Number(parameters[name] ?? schema.default);
    if (!Number.isFinite(value) || value < schema.min || value > schema.max || (schema.type === "integer" && !Number.isInteger(value))) throw new Error(`${id}.${name} must be a ${schema.type} between ${schema.min} and ${schema.max}`);
  }
  for (const constraint of item.parameterConstraints) {
    const error = constraint.validate({ ...Object.fromEntries(Object.entries(item.parameters).map(([name, schema]) => [name, parameters[name] ?? schema.default])), ...parameters });
    if (error) throw new Error(`${id}: ${error}`);
  }
  return item;
}
export function calculateIndicator(id: string, candles: Candle[], raw: Record<string, unknown> = {}): FeatureSeries {
  const definition = validateIndicator(id, raw), p = { ...Object.fromEntries(Object.entries(definition.parameters).map(([key, v]) => [key, v.default])), ...raw } as Record<string, number>;
  const c = close(candles), h = high(candles), l = low(candles), v = volume(candles), periodValue = Number(p.period ?? 14);
  if (id === "sma") return { sma: rolling(c, periodValue, (x) => x.reduce((a, b) => a + b, 0) / x.length) };
  if (id === "ema") return { ema: ema(c, periodValue) };
  if (id === "wma") return { wma: rolling(c, periodValue, (x) => x.reduce((a, b, i) => a + b * (i + 1), 0) / ((x.length * (x.length + 1)) / 2)) };
  if (id === "vwma") return { vwma: rolling(c, periodValue, () => 0).map((_, i) => { if (i < periodValue - 1) return NaN; let pv = 0, vv = 0; for (let j = i - periodValue + 1; j <= i; j++) { pv += c[j] * v[j]; vv += v[j]; } return vv ? pv / vv : NaN; }) };
  if (id === "true_range") return { true_range: trueRange(candles) };
  if (id === "atr" || id === "atr_percent") { const a = ema(trueRange(candles), periodValue); return id === "atr" ? { atr: a } : { atr_percent: Float64Array.from(a, (x, i) => (x / c[i]) * 100) }; }
  if (id === "macd") { const macd = Float64Array.from(c, (x, i) => ema(c, Number(p.fast))[i] - ema(c, Number(p.slow))[i]); const signal = ema(macd, Number(p.signal)); return { macd, signal, histogram: Float64Array.from(macd, (x, i) => x - signal[i]) }; }
  if (id === "adx") { const plus = nan(c.length), minus = nan(c.length); plus[0] = minus[0] = 0; for (let i = 1; i < c.length; i++) { const up = h[i] - h[i - 1], down = l[i - 1] - l[i]; plus[i] = up > down && up > 0 ? up : 0; minus[i] = down > up && down > 0 ? down : 0; } const tr = wilder(trueRange(candles), periodValue), plusSmoothed = wilder(plus, periodValue), minusSmoothed = wilder(minus, periodValue); const plusDi = Float64Array.from(c, (_, i) => tr[i] ? 100 * plusSmoothed[i] / tr[i] : NaN), minusDi = Float64Array.from(c, (_, i) => tr[i] ? 100 * minusSmoothed[i] / tr[i] : NaN), dx = Float64Array.from(c, (_, i) => plusDi[i] + minusDi[i] ? 100 * Math.abs(plusDi[i] - minusDi[i]) / (plusDi[i] + minusDi[i]) : NaN); return { adx: wilder(dx, periodValue), plus_di: plusDi, minus_di: minusDi }; }
  if (id === "supertrend") { const atr = ema(trueRange(candles), Number(p.period)), multiple = Number(p.multiple), line = nan(c.length), direction = nan(c.length); for (let i = 0; i < c.length; i++) { if (!Number.isFinite(atr[i])) continue; const midpoint = (h[i] + l[i]) / 2, basicUpper = midpoint + multiple * atr[i], basicLower = midpoint - multiple * atr[i]; if (i === 0 || !Number.isFinite(line[i - 1])) { line[i] = basicLower; direction[i] = 1; continue; } const priorDirection = direction[i - 1], priorLine = line[i - 1]; if (priorDirection > 0) { direction[i] = c[i] < priorLine ? -1 : 1; line[i] = direction[i] > 0 ? Math.max(basicLower, priorLine) : basicUpper; } else { direction[i] = c[i] > priorLine ? 1 : -1; line[i] = direction[i] < 0 ? Math.min(basicUpper, priorLine) : basicLower; } } return { supertrend: line, direction }; }
  if (id === "linear_regression_slope") return { slope: rolling(c, periodValue, (values) => { const xMean = (values.length - 1) / 2, yMean = mean(values); let numerator = 0, denominator = 0; for (let i = 0; i < values.length; i++) { numerator += (i - xMean) * (values[i] - yMean); denominator += (i - xMean) ** 2; } return denominator ? numerator / denominator : 0; }) };
  if (id === "price_distance_ma") { const average = ema(c, periodValue); return { distance_pct: Float64Array.from(c, (x, i) => average[i] ? (x / average[i] - 1) * 100 : NaN) }; }
  if (id === "moving_average_slope") { const average = ema(c, periodValue), slopePeriod = Number(p.slopePeriod); return { ma_slope_pct: Float64Array.from(average, (x, i) => i < slopePeriod || !average[i - slopePeriod] ? NaN : (x / average[i - slopePeriod] - 1) * 100) }; }
  if (id === "moving_average_alignment") { const fast = ema(c, Number(p.fast)), medium = ema(c, Number(p.medium)), slow = ema(c, Number(p.slow)); return { alignment: Float64Array.from(c, (_, i) => fast[i] > medium[i] && medium[i] > slow[i] ? 1 : fast[i] < medium[i] && medium[i] < slow[i] ? -1 : 0) }; }
  if (id === "rsi") { const gains = nan(c.length), losses = nan(c.length); gains[0] = losses[0] = 0; for (let i = 1; i < c.length; i++) { gains[i] = Math.max(0, c[i] - c[i - 1]); losses[i] = Math.max(0, c[i - 1] - c[i]); } const ag = ema(gains, periodValue), al = ema(losses, periodValue); return { rsi: Float64Array.from(c, (_, i) => al[i] === 0 ? (ag[i] === 0 ? NaN : 100) : 100 - 100 / (1 + ag[i] / al[i])) }; }
  if (id === "stochastic_rsi") { const rsi = calculateIndicator("rsi", candles, { period: Number(p.rsiPeriod) }).rsi, highest = rolling(rsi, periodValue, (x) => Math.max(...x)), lowest = rolling(rsi, periodValue, (x) => Math.min(...x)); return { stochastic_rsi: Float64Array.from(rsi, (x, i) => highest[i] === lowest[i] ? NaN : (x - lowest[i]) / (highest[i] - lowest[i]) * 100) }; }
  if (id === "stochastic" || id === "williams_r") { const upper = rolling(h, periodValue, (x) => Math.max(...x)), lower = rolling(l, periodValue, (x) => Math.min(...x)); return id === "stochastic" ? { stochastic_k: Float64Array.from(c, (x, i) => (x - lower[i]) / (upper[i] - lower[i]) * 100) } : { williams_r: Float64Array.from(c, (x, i) => (upper[i] - x) / (upper[i] - lower[i]) * -100) }; }
  if (id === "cci") { const typical = Float64Array.from(c, (x, i) => (h[i] + l[i] + x) / 3), average = rolling(typical, periodValue, (x) => x.reduce((a, b) => a + b, 0) / x.length); return { cci: Float64Array.from(typical, (x, i) => { if (i < periodValue - 1) return NaN; const values = Array.from(typical.slice(i - periodValue + 1, i + 1)), deviation = values.reduce((sum, v) => sum + Math.abs(v - average[i]), 0) / periodValue; return deviation ? (x - average[i]) / (.015 * deviation) : 0; }) }; }
  if (id === "roc") return { roc: Float64Array.from(c, (x, i) => i < periodValue ? NaN : ((x / c[i - periodValue]) - 1) * 100) };
  if (id === "momentum") return { momentum: Float64Array.from(c, (x, i) => i < periodValue ? NaN : x - c[i - periodValue]) };
  if (id === "bollinger") { const middle = rolling(c, periodValue, (x) => x.reduce((a, b) => a + b, 0) / x.length); const deviation = rolling(c, periodValue, std), d = Number(p.deviations); const upper = Float64Array.from(middle, (x, i) => x + d * deviation[i]), lower = Float64Array.from(middle, (x, i) => x - d * deviation[i]); return { middle, upper, lower, width: Float64Array.from(middle, (x, i) => (upper[i] - lower[i]) / x), percent_b: Float64Array.from(c, (x, i) => (x - lower[i]) / (upper[i] - lower[i])) }; }
  if (id === "rolling_stddev") return { stddev: rolling(c, periodValue, std) };
  if (id === "historical_volatility") { const returns = Float64Array.from(c, (x, i) => i ? Math.log(x / c[i - 1]) : NaN); return { historical_volatility: Float64Array.from(rolling(returns, periodValue, std), (x) => x * Math.sqrt(365 * 24 * 12) * 100) }; }
  if (id === "keltner") { const middle = ema(c, periodValue), atr = ema(trueRange(candles), Number(p.atrPeriod)), multiple = Number(p.multiple); return { middle, upper: Float64Array.from(middle, (x, i) => x + multiple * atr[i]), lower: Float64Array.from(middle, (x, i) => x - multiple * atr[i]) }; }
  if (id === "choppiness_index") { const tr = trueRange(candles), trSum = rolling(tr, periodValue, (x) => x.reduce((a, b) => a + b, 0)); const highest = rolling(h, periodValue, (x) => Math.max(...x)), lowest = rolling(l, periodValue, (x) => Math.min(...x)); return { choppiness: Float64Array.from(c, (_, i) => trSum[i] > 0 && highest[i] > lowest[i] ? 100 * Math.log10(trSum[i] / (highest[i] - lowest[i])) / Math.log10(periodValue) : NaN) }; }
  if (id === "volatility_percentile") { const returnsSeries = returns(c), localVolatility = rolling(returnsSeries, periodValue, std), rankPeriod = Number(p.rankPeriod); return { volatility_percentile: rollingRank(localVolatility, rankPeriod) }; }
  if (id === "volume_sma") return { volume_sma: rolling(v, periodValue, (x) => x.reduce((a, b) => a + b, 0) / x.length) };
  if (["quote_volume_sma", "relative_quote_volume", "quote_volume_zscore"].includes(id)) { const qv = quoteVolume(candles), average = rolling(qv, periodValue, mean); if (id === "quote_volume_sma") return { quote_volume_sma: average }; if (id === "relative_quote_volume") return { relative_quote_volume: Float64Array.from(qv, (x, i) => x / average[i]) }; const deviation = rolling(qv, periodValue, std); return { quote_volume_zscore: Float64Array.from(qv, (x, i) => deviation[i] ? (x - average[i]) / deviation[i] : NaN) }; }
  if (id === "average_trade_size") return { average_trade_size: Float64Array.from(candles, (x) => x.tradeCount ? n(x.volume) / x.tradeCount : NaN) };
  if (id === "average_trade_notional") return { average_trade_notional: Float64Array.from(candles, (x) => x.tradeCount ? n(x.quoteVolume) / x.tradeCount : NaN) };
  if (id === "relative_volume" || id === "volume_zscore") { const mean = rolling(v, periodValue, (x) => x.reduce((a, b) => a + b, 0) / x.length); if (id === "relative_volume") return { relative_volume: Float64Array.from(v, (x, i) => x / mean[i]) }; const sd = rolling(v, periodValue, std); return { volume_zscore: Float64Array.from(v, (x, i) => (x - mean[i]) / sd[i]) }; }
  if (id === "relative_trade_count" || id === "trade_count_zscore") { const counts = tradeCount(candles), average = rolling(counts, periodValue, mean); if (id === "relative_trade_count") return { relative_trade_count: Float64Array.from(counts, (x, i) => x / average[i]) }; const deviation = rolling(counts, periodValue, std); return { trade_count_zscore: Float64Array.from(counts, (x, i) => deviation[i] ? (x - average[i]) / deviation[i] : NaN) }; }
  if (id === "obv") { const out = nan(c.length); let total = 0; for (let i = 0; i < c.length; i++) { if (i) total += c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0; out[i] = total; } return { obv: out }; }
  if (id === "money_flow_index") { const typical = Float64Array.from(c, (x, i) => (h[i] + l[i] + x) / 3), positive = nan(c.length), negative = nan(c.length); positive[0] = negative[0] = 0; for (let i = 1; i < c.length; i++) { const flow = typical[i] * v[i]; positive[i] = typical[i] > typical[i - 1] ? flow : 0; negative[i] = typical[i] < typical[i - 1] ? flow : 0; } const positiveSum = rolling(positive, periodValue, (x) => x.reduce((a, b) => a + b, 0)), negativeSum = rolling(negative, periodValue, (x) => x.reduce((a, b) => a + b, 0)); return { mfi: Float64Array.from(c, (_, i) => negativeSum[i] === 0 ? (positiveSum[i] ? 100 : NaN) : 100 - 100 / (1 + positiveSum[i] / negativeSum[i])) }; }
  if (id === "chaikin_money_flow" || id === "accumulation_distribution") { const flow = Float64Array.from(c, (x, i) => h[i] === l[i] ? 0 : ((2 * x - l[i] - h[i]) / (h[i] - l[i])) * v[i]); if (id === "accumulation_distribution") return { adl: cumulative(flow) }; const flowSum = rolling(flow, periodValue, (x) => x.reduce((a, b) => a + b, 0)), volumeSum = rolling(v, periodValue, (x) => x.reduce((a, b) => a + b, 0)); return { cmf: Float64Array.from(flowSum, (x, i) => volumeSum[i] ? x / volumeSum[i] : NaN) }; }
  if (id === "volume_price_trend") { const change = returns(c); return { vpt: cumulative(Float64Array.from(v, (x, i) => i ? x * change[i] : 0)) }; }
  if (["taker_buy_ratio", "taker_sell_ratio", "relative_base_delta", "base_volume_delta", "quote_volume_delta", "relative_quote_delta", "cumulative_volume_delta", "delta_ema", "delta_zscore", "taker_buy_ratio_ema", "consecutive_buyer_dominant", "consecutive_seller_dominant"].includes(id)) { const delta = Float64Array.from(candles, (x) => 2 * n(x.takerBuyBaseVolume) - n(x.volume)), quoteDelta = Float64Array.from(candles, (x) => 2 * n(x.takerBuyQuoteVolume) - n(x.quoteVolume)), buyRatio = Float64Array.from(candles, (x) => n(x.volume) ? n(x.takerBuyBaseVolume) / n(x.volume) : NaN); if (id === "taker_buy_ratio") return { taker_buy_ratio: buyRatio }; if (id === "taker_sell_ratio") return { taker_sell_ratio: Float64Array.from(buyRatio, (x) => 1 - x) }; if (id === "base_volume_delta") return { base_volume_delta: delta }; if (id === "quote_volume_delta") return { quote_volume_delta: quoteDelta }; if (id === "relative_base_delta") return { relative_base_delta: Float64Array.from(delta, (x, i) => v[i] ? x / v[i] : NaN) }; if (id === "relative_quote_delta") { const qv = quoteVolume(candles); return { relative_quote_delta: Float64Array.from(quoteDelta, (x, i) => qv[i] ? x / qv[i] : NaN) }; } if (id === "delta_ema") return { delta_ema: ema(delta, periodValue) }; if (id === "taker_buy_ratio_ema") return { taker_buy_ratio_ema: ema(buyRatio, periodValue) }; if (id === "delta_zscore") { const average = rolling(delta, periodValue, mean), deviation = rolling(delta, periodValue, std); return { delta_zscore: Float64Array.from(delta, (x, i) => deviation[i] ? (x - average[i]) / deviation[i] : NaN) }; } if (id === "consecutive_buyer_dominant" || id === "consecutive_seller_dominant") { const buyers = id === "consecutive_buyer_dominant"; const out = nan(c.length); let streak = 0; for (let i = 0; i < c.length; i++) { streak = (buyers ? buyRatio[i] > .5 : buyRatio[i] < .5) ? streak + 1 : 0; out[i] = streak; } return { [id]: out }; } return { cvd: cumulative(delta) }; }
  if (id === "highest_high") return { highest_high: rolling(h, periodValue, (x) => Math.max(...x)) };
  if (id === "lowest_low") return { lowest_low: rolling(l, periodValue, (x) => Math.min(...x)) };
  if (id === "donchian") { const upper = nan(c.length), lower = nan(c.length); for (let i = periodValue; i < c.length; i++) { upper[i] = Math.max(...Array.from(h.slice(i - periodValue, i))); lower[i] = Math.min(...Array.from(l.slice(i - periodValue, i))); } return { upper, lower, middle: Float64Array.from(upper, (x, i) => Number.isFinite(x) && Number.isFinite(lower[i]) ? (x + lower[i]) / 2 : NaN) }; }
  if (id === "swing_high" || id === "swing_low") { const source = id === "swing_high" ? h : l, isHigh = id === "swing_high", out = nan(c.length); let latest = Number.NaN; for (let i = periodValue * 2; i < source.length; i++) { const pivot = i - periodValue, window = Array.from(source.slice(i - periodValue * 2, i + 1)), value = source[pivot], extreme = isHigh ? Math.max(...window) : Math.min(...window); if (value === extreme && window.filter((x) => x === extreme).length === 1) latest = value; out[i] = latest; } return { [id]: out }; }
  if (id === "donchian_breakout" || id === "breakout_age") { const up = nan(c.length), down = nan(c.length), age = nan(c.length); let since = Number.NaN; for (let i = periodValue; i < c.length; i++) { const priorHigh = Math.max(...Array.from(h.slice(i - periodValue, i))), priorLow = Math.min(...Array.from(l.slice(i - periodValue, i))); up[i] = c[i] > priorHigh ? 1 : 0; down[i] = c[i] < priorLow ? 1 : 0; since = up[i] || down[i] ? 0 : Number.isFinite(since) ? since + 1 : Number.NaN; age[i] = since; } return id === "donchian_breakout" ? { breakout_up: up, breakout_down: down } : { bars_since_breakout: age }; }
  if (id === "distance_to_recent_high" || id === "distance_to_recent_low") { const reference = id === "distance_to_recent_high" ? rolling(h, periodValue, (x) => Math.max(...x)) : rolling(l, periodValue, (x) => Math.min(...x)); return { distance_pct: Float64Array.from(c, (x, i) => reference[i] ? (x / reference[i] - 1) * 100 : NaN) }; }
  if (id === "price_extension_atr") { const average = ema(c, Number(p.emaPeriod)), atr = ema(trueRange(candles), Number(p.atrPeriod)); return { extension_atr: Float64Array.from(c, (x, i) => atr[i] ? (x - average[i]) / atr[i] : NaN) }; }
  if (id === "inside_bar" || id === "outside_bar") return { [id]: Float64Array.from(c, (_, i) => { if (!i) return NaN; return id === "inside_bar" ? (h[i] < h[i - 1] && l[i] > l[i - 1] ? 1 : 0) : (h[i] > h[i - 1] && l[i] < l[i - 1] ? 1 : 0); }) };
  if (id === "candle_body_size") return { body_size: Float64Array.from(candles, (x) => Math.abs(n(x.close) - n(x.open))) };
  if (id === "candle_range") return { range: Float64Array.from(candles, (x) => n(x.high) - n(x.low)) };
  if (id === "upper_wick_size") return { upper_wick: Float64Array.from(candles, (x) => n(x.high) - Math.max(n(x.open), n(x.close))) };
  if (id === "lower_wick_size") return { lower_wick: Float64Array.from(candles, (x) => Math.min(n(x.open), n(x.close)) - n(x.low)) };
  if (id === "candle_body_ratio") return { body_to_range: Float64Array.from(candles, (x) => { const r = n(x.high) - n(x.low); return r ? Math.abs(n(x.close) - n(x.open)) / r : 0; }) };
  if (id === "close_position_in_range") return { close_position: Float64Array.from(candles, (x) => { const range = n(x.high) - n(x.low); return range ? (n(x.close) - n(x.low)) / range : .5; }) };
  if (id === "simple_return" || id === "log_return") return { [id === "simple_return" ? "return" : "log_return"]: Float64Array.from(c, (x, i) => i ? (id === "simple_return" ? x / c[i - 1] - 1 : Math.log(x / c[i - 1])) : NaN) };
  if (["rolling_mean_return", "rolling_median_return", "return_zscore", "rolling_skewness", "rolling_kurtosis", "rolling_autocorrelation"].includes(id)) { const ret = returns(c); if (id === "rolling_mean_return") return { mean_return: rolling(ret, periodValue, mean) }; if (id === "rolling_median_return") return { median_return: rolling(ret, periodValue, median) }; if (id === "return_zscore") { const average = rolling(ret, periodValue, mean), deviation = rolling(ret, periodValue, std); return { return_zscore: Float64Array.from(ret, (x, i) => deviation[i] ? (x - average[i]) / deviation[i] : NaN) }; } if (id === "rolling_skewness" || id === "rolling_kurtosis") return { [id === "rolling_skewness" ? "skewness" : "kurtosis"]: rolling(ret, periodValue, (values) => { const average = mean(values), deviation = std(values); if (!deviation) return 0; const moment = mean(values.map((x) => ((x - average) / deviation) ** (id === "rolling_skewness" ? 3 : 4))); return id === "rolling_skewness" ? moment : moment - 3; }) }; return { autocorrelation: rolling(ret, periodValue, (values) => { const average = mean(values); let numerator = 0, denominator = 0; for (let i = 1; i < values.length; i++) numerator += (values[i] - average) * (values[i - 1] - average); for (const value of values) denominator += (value - average) ** 2; return denominator ? numerator / denominator : 0; }) }; }
  if (id === "percentile_rank") return { percentile_rank: rollingRank(c, periodValue) };
  if (id === "price_zscore") { const mean = rolling(c, periodValue, (x) => x.reduce((a, b) => a + b, 0) / x.length), sd = rolling(c, periodValue, std); return { price_zscore: Float64Array.from(c, (x, i) => (x - mean[i]) / sd[i]) }; }
  if (id === "rolling_drawdown") return { drawdown: Float64Array.from(c, (x, i) => { const start = Math.max(0, i - periodValue + 1); return x / Math.max(...Array.from(c.slice(start, i + 1))) - 1; }) };
  if (id === "hour_utc") return { hour_utc: Float64Array.from(candles, (x) => x.closeTime.getUTCHours()) };
  if (id === "day_of_week") return { day_of_week: Float64Array.from(candles, (x) => x.closeTime.getUTCDay()) };
  if (id === "month_of_year") return { month_of_year: Float64Array.from(candles, (x) => x.closeTime.getUTCMonth() + 1) };
  if (id === "quarter_of_year") return { quarter_of_year: Float64Array.from(candles, (x) => Math.floor(x.closeTime.getUTCMonth() / 3) + 1) };
  if (id === "week_of_year") return { week_of_year: Float64Array.from(candles, (x) => { const date = new Date(Date.UTC(x.closeTime.getUTCFullYear(), x.closeTime.getUTCMonth(), x.closeTime.getUTCDate())), day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7); }) };
  if (id === "is_weekend") return { is_weekend: Float64Array.from(candles, (x) => { const day = x.closeTime.getUTCDay(); return day === 0 || day === 6 ? 1 : 0; }) };
  if (id === "is_month_start") return { is_month_start: Float64Array.from(candles, (x) => x.closeTime.getUTCDate() === 1 ? 1 : 0) };
  if (id === "is_month_end") return { is_month_end: Float64Array.from(candles, (x) => { const day = x.closeTime, next = new Date(day.getTime() + 86400000); return next.getUTCMonth() !== day.getUTCMonth() ? 1 : 0; }) };
  throw new Error(`No calculation registered for ${id}`);
}
