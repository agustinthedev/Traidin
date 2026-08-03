import { canonicalJson, type StrategyConfig } from "./model.js";
import { indicatorRegistry } from "./indicators.js";

export const RESEARCH_FORMATTER_VERSION = "2026.09.human-description.1";

const aliases: Record<string, string> = {
  sma: "SMA", ema: "EMA", wma: "WMA", vwma: "VWMA", rsi: "RSI", macd: "MACD",
  adx: "ADX", atr: "ATR", bollinger: "Bollinger Bands", donchian: "Donchian",
  relative_volume: "Relative Volume", supertrend: "Supertrend", stochastic: "Stochastic",
  money_flow_index: "MFI", chaikin_money_flow: "Chaikin Money Flow", obv: "OBV",
};
const operatorText: Record<string, string> = {
  ">": "is above", ">=": "is at or above", "<": "is below", "<=": "is at or below",
  "==": "equals", "!=": "does not equal", crosses_above: "crosses above", crosses_below: "crosses below",
  is_true: "is true", is_false: "is false", between: "is between", outside: "is outside",
};
const indent = (level: number) => "  ".repeat(level);
const value = (input: unknown) => typeof input === "number" && Number.isFinite(input) ? String(input) : String(input ?? "-");
const timeframe = (input: unknown) => input ? ` on ${String(input)}` : "";

function displayIndicator(id: string, parameters: Record<string, unknown>, output?: string) {
  const definition = indicatorRegistry[id];
  const name = aliases[id] ?? definition?.name ?? `Unsupported indicator ${id}`;
  const entries = Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right));
  const params = entries.length ? `(${entries.map(([key, parameter]) => `${key}=${value(parameter)}`).join(", ")})` : "";
  const outputLabel = output && definition && definition.outputs.length > 1 ? ` [${output}]` : "";
  return `${name}${params}${outputLabel}`;
}

function formatValueRef(ref: unknown): string {
  if (!ref || typeof ref !== "object") return `[Unsupported value: ${String(ref)}]`;
  const item = ref as Record<string, unknown>;
  if (item.type === "constant") return value(item.value);
  if (item.type === "price") return `${String(item.field ?? "close").replace(/^./, (letter) => letter.toUpperCase())}${timeframe(item.timeframe)}`;
  if (item.type === "indicator") return `${displayIndicator(String(item.indicator), (item.parameters ?? {}) as Record<string, unknown>, item.output as string | undefined)}${timeframe(item.timeframe)}`;
  if (item.type === "feature") return `${String(item.feature)}${timeframe(item.timeframe)}`;
  return `[Unsupported value node: ${JSON.stringify(item)}]`;
}

function formatCondition(node: unknown, level = 0): string[] {
  if (!node || typeof node !== "object") return [`${indent(level)}- [Unsupported condition node: ${String(node)}]`];
  const item = node as Record<string, unknown>;
  if (item.type === "group") {
    const children = Array.isArray(item.children) ? item.children : [];
    const operator = String(item.operator ?? "AND");
    if (!children.length) return [`${indent(level)}- [Unsupported empty ${operator} group]`];
    if (level === 0) return children.flatMap((child) => formatCondition(child, level));
    return [`${indent(level)}- ${operator} group:`, ...children.flatMap((child) => formatCondition(child, level + 1))];
  }
  const left = formatValueRef(item.left);
  const operator = operatorText[String(item.operator)] ?? `[Unsupported operator ${String(item.operator)}]`;
  const right = Array.isArray(item.right) ? item.right.map(formatValueRef).join(" and ") : item.right == null ? "" : ` ${formatValueRef(item.right)}`;
  return [`${indent(level)}- ${left} ${operator}${right}.`];
}

function section(title: string, node: unknown) {
  return [title, ...formatCondition(node)];
}

function policyLines(config: StrategyConfig) {
  const lines = ["Risk and execution"];
  const stop = config.stop;
  if (stop.type === "PERCENTAGE") lines.push(`- Stop loss: ${value(stop.percentage)}%.`);
  else if (stop.type === "ATR") lines.push(`- Stop loss: ${value(stop.multiple)} ATR${timeframe(stop.timeframe)} (period ${value(stop.period)}).`);
  else if (stop.type === "STRUCTURE") lines.push(`- Stop loss: ${stop.reference} structure (lookback ${value(stop.lookback)}).`);
  else lines.push(`- Stop loss: [Unsupported ${String((stop as { type?: unknown }).type)} policy].`);
  const takeProfit = config.takeProfit;
  if (takeProfit.type === "R_MULTIPLE") lines.push(`- Take profit: ${value(takeProfit.multiple)}R.`);
  else if (takeProfit.type === "PERCENTAGE") lines.push(`- Take profit: ${value(takeProfit.percentage)}%.`);
  else if (takeProfit.type === "NONE") lines.push("- Take profit: none.");
  else lines.push(`- Take profit: [Unsupported ${String((takeProfit as { type?: unknown }).type)} policy].`);
  const trailing = config.trailing;
  if (trailing.type === "PERCENTAGE") lines.push(`- Trailing stop: ${value(trailing.percentage)}%.`);
  else if (trailing.type === "ATR") lines.push(`- Trailing stop: ${value(trailing.multiple)} ATR${timeframe(trailing.timeframe)} (period ${value(trailing.period)}).`);
  else if (trailing.type === "MOVING_AVERAGE") lines.push(`- Trailing stop: ${displayIndicator(trailing.indicator, { period: trailing.period })}${timeframe(trailing.timeframe)}.`);
  else if (trailing.type === "STRUCTURE") lines.push(`- Trailing stop: ${trailing.reference} structure (lookback ${value(trailing.lookback)}).`);
  const sizing = config.sizing;
  if (sizing.type === "FIXED_RISK") lines.push(`- Risk per trade: ${value(sizing.riskPct)}%.`);
  else if (sizing.type === "FIXED_NOTIONAL") lines.push(`- Position sizing: fixed notional ${value(sizing.notional)}.`);
  else if (sizing.type === "EQUITY_PERCENT") lines.push(`- Position sizing: ${value(sizing.percentage)}% of equity.`);
  else if (sizing.type === "VOLATILITY_BASED") lines.push(`- Position sizing: ${value(sizing.riskPct)}% volatility risk${timeframe(sizing.timeframe)} (ATR period ${value(sizing.atrPeriod)}).`);
  lines.push(`- Leverage: ${value(config.leverage.fixed)}x fixed, ${value(config.leverage.maximum)}x maximum${config.leverage.isolated ? " isolated" : " cross"}.`);
  lines.push(`- Execution timeframe: ${config.executionTimeframe}.`);
  lines.push(`- Fees: maker ${value(config.costs.makerFeePct)}%, taker ${value(config.costs.takerFeePct)}%.`);
  lines.push(`- Slippage: ${value(config.costs.slippageBps)} bps per fill.`);
  lines.push(`- Funding: ${config.costs.fundingMode === "FIXED" ? `${value(config.costs.fixedFundingPct)}% fixed` : "not modeled"}.`);
  return lines;
}

export function describeCandidate(normalizedAst: Record<string, unknown>, config: StrategyConfig): string {
  const lines = [
    ...section("Long", normalizedAst.longEntry),
    ...section("Short", normalizedAst.shortEntry),
  ];
  const shared = normalizedAst.sharedFilters;
  if (Array.isArray(shared) && shared.length) {
    lines.push("Shared filters", ...shared.flatMap((node) => formatCondition(node)));
  } else {
    const long = Array.isArray((normalizedAst.longEntry as Record<string, unknown> | undefined)?.children) ? ((normalizedAst.longEntry as Record<string, unknown>).children as unknown[]) : [];
    const short = Array.isArray((normalizedAst.shortEntry as Record<string, unknown> | undefined)?.children) ? ((normalizedAst.shortEntry as Record<string, unknown>).children as unknown[]) : [];
    const common = long.filter((node) => short.some((other) => canonicalJson(node) === canonicalJson(other)));
    if (common.length) lines.push("Shared filters", ...common.flatMap((node) => formatCondition(node)));
  }
  lines.push(...policyLines(config));
  return lines.join("\n");
}
