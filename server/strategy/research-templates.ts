import {
  indicatorOutputSemantics,
  indicatorRegistry,
  validateIndicator,
} from "./indicators.js";
import { TIMEFRAMES, type ConditionNode, type ValueRef } from "./model.js";

export type TemplateRole =
  | "DIRECTIONAL_TRIGGER"
  | "CONFIRMATION_FILTER"
  | "SHARED_FILTER"
  | "REGIME_FILTER"
  | "EXIT_TRIGGER";
export type ComplementBehavior = "INVERSE" | "COMPLEMENTARY" | "SHARED";
export type TemplateBuild = {
  long: ConditionNode;
  short: ConditionNode;
  directional: boolean;
  role: TemplateRole;
};
export type ResearchTemplate = {
  id: string;
  version: string;
  displayName: string;
  compatibleSemanticTypes: string[];
  compatibleIndicators: string[];
  supportedRole: TemplateRole;
  standAlone: boolean;
  complementBehavior: ComplementBehavior;
  parameterGeneration: (
    indicator: string,
    random: () => number,
  ) => Record<string, unknown>;
  operandGeneration: (
    indicator: string,
    output: string,
    parameters: Record<string, unknown>,
    random: () => number,
  ) => ValueRef;
  buildLong: (
    operand: ValueRef,
    timeframe: string,
    random: () => number,
  ) => ConditionNode;
  buildShort: (
    operand: ValueRef,
    timeframe: string,
    random: () => number,
  ) => ConditionNode;
  validate: (
    indicator: string,
    output: string,
    parameters: Record<string, unknown>,
  ) => string[];
  complexityContribution: number;
  describe: (
    indicator: string,
    output: string,
    parameters: Record<string, unknown>,
  ) => string;
};

const frame = (value: string) =>
  TIMEFRAMES.includes(value as (typeof TIMEFRAMES)[number])
    ? (value as (typeof TIMEFRAMES)[number])
    : "1m";
const constant = (value: number): ValueRef => ({ type: "constant", value });
const price = (timeframe: string): ValueRef => ({
  type: "price",
  field: "close",
  timeframe: frame(timeframe),
});
const reference = (
  indicator: string,
  parameters: Record<string, unknown>,
  timeframe: string,
  output: string,
): ValueRef => ({
  type: "indicator",
  indicator,
  parameters: parameters as Record<string, string | number | boolean>,
  timeframe: frame(timeframe),
  output,
});
const leaf = (
  left: ValueRef,
  operator: Extract<ConditionNode, { left: ValueRef }>["operator"],
  right?: ValueRef,
): ConditionNode =>
  ({ left, operator, ...(right ? { right } : {}) }) as ConditionNode;
const paramsFor = (indicator: string, random: () => number) => {
  const definition = indicatorRegistry[indicator];
  if (!definition) throw new Error(`TEMPLATE_INDICATOR_MISSING:${indicator}`);
  const values = Object.fromEntries(
    Object.entries(definition.parameters).map(([name, parameter]) => {
      const options = [
        ...new Set([
          parameter.default,
          parameter.min,
          Math.round((parameter.min + parameter.max) / 2),
          parameter.max,
        ]),
      ];
      const value =
        options[
          Math.min(options.length - 1, Math.floor(random() * options.length))
        ]!;
      return [
        name,
        parameter.type === "integer" ? Math.round(Number(value)) : value,
      ];
    }),
  );
  if (indicator === "macd")
    Object.assign(values, {
      fast: [5, 8, 12, 20][Math.floor(random() * 4)],
      slow: [26, 34, 50, 100][Math.floor(random() * 4)],
      signal: [5, 9, 15][Math.floor(random() * 3)],
    });
  if (indicator === "moving_average_alignment")
    Object.assign(values, { fast: 20, medium: 50, slow: 200 });
  if (indicator === "bollinger")
    values.deviations = [1.5, 2, 2.5, 3][Math.floor(random() * 4)];
  if (indicator === "supertrend")
    values.multiple = [1, 2, 3, 4][Math.floor(random() * 4)];
  validateIndicator(indicator, values);
  return values;
};
const threshold =
  (
    direction: "above" | "below" | "crossAbove" | "crossBelow",
    min: number,
    max: number,
  ) =>
  (operand: ValueRef) => {
    const lower = min + (max - min) * 0.3,
      upper = min + (max - min) * 0.7;
    if (direction === "above") return leaf(operand, ">", constant(upper));
    if (direction === "below") return leaf(operand, "<", constant(lower));
    return leaf(
      operand,
      direction === "crossAbove" ? "crosses_above" : "crosses_below",
      constant(direction === "crossAbove" ? lower : upper),
    );
  };
const factory = (
  id: string,
  displayName: string,
  role: TemplateRole,
  semanticTypes: string[],
  complementBehavior: ComplementBehavior,
  build: (
    operand: ValueRef,
    random: () => number,
  ) => { long: ConditionNode; short: ConditionNode },
  complexity = 1,
): ResearchTemplate => ({
  id,
  version: "1.0.0",
  displayName,
  compatibleSemanticTypes: semanticTypes,
  compatibleIndicators: [],
  supportedRole: role,
  standAlone: role === "DIRECTIONAL_TRIGGER",
  complementBehavior,
  parameterGeneration: paramsFor,
  operandGeneration: (indicator, output, parameters, random) =>
    reference(indicator, parameters, "1m", output),
  buildLong: (operand, _timeframe, random) => build(operand, random).long,
  buildShort: (operand, _timeframe, random) => build(operand, random).short,
  validate: (indicator, output, parameters) => {
    const metadata = indicatorOutputSemantics(indicator, output);
    return metadata ? [] : [`UNKNOWN_OUTPUT:${indicator}.${output}`];
  },
  complexityContribution: complexity,
  describe: (indicator, output, parameters) =>
    `${displayName}: ${indicator}.${output} ${JSON.stringify(parameters)}`,
});

const templates: ResearchTemplate[] = [
  factory(
    "RSI_MOMENTUM_THRESHOLD",
    "RSI momentum threshold",
    "DIRECTIONAL_TRIGGER",
    ["BOUNDED_OSCILLATOR"],
    "COMPLEMENTARY",
    (o, r) => ({
      long: threshold("crossAbove", 0, 100)(o),
      short: threshold("crossBelow", 0, 100)(o),
    }),
  ),
  factory(
    "BOUNDED_THRESHOLD",
    "Bounded oscillator threshold",
    "DIRECTIONAL_TRIGGER",
    ["BOUNDED_OSCILLATOR"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(50)),
      short: leaf(o, "crosses_below", constant(50)),
    }),
  ),
  factory(
    "RSI_MEAN_REVERSION_CROSS",
    "RSI mean-reversion crossing",
    "DIRECTIONAL_TRIGGER",
    ["BOUNDED_OSCILLATOR"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(30)),
      short: leaf(o, "crosses_below", constant(70)),
    }),
  ),
  factory(
    "STOCHASTIC_THRESHOLD_CROSS",
    "Stochastic threshold crossing",
    "DIRECTIONAL_TRIGGER",
    ["BOUNDED_OSCILLATOR"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(20)),
      short: leaf(o, "crosses_below", constant(80)),
    }),
  ),
  factory(
    "CCI_ZERO_EXTREME_CROSS",
    "CCI zero/extreme crossing",
    "DIRECTIONAL_TRIGGER",
    ["SIGNED_DIRECTIONAL_VALUE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "ROC_ZERO_CROSS",
    "ROC zero crossing",
    "DIRECTIONAL_TRIGGER",
    ["SIGNED_DIRECTIONAL_VALUE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "PRICE_ABOVE_BELOW_MA",
    "Price above/below moving average",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL"],
    "INVERSE",
    (o) => ({
      long: leaf(price("1h"), "crosses_above", o),
      short: leaf(price("1h"), "crosses_below", o),
    }),
  ),
  factory(
    "PRICE_MA_CROSSOVER",
    "Price/MA crossover",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL"],
    "INVERSE",
    (o) => ({
      long: leaf(price("1h"), "crosses_above", o),
      short: leaf(price("1h"), "crosses_below", o),
    }),
  ),
  factory(
    "FAST_SLOW_MA_CROSS",
    "Fast/slow moving-average crossover",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL", "SIGNED_DIRECTIONAL_VALUE", "UNBOUNDED_OSCILLATOR"],
    "INVERSE",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "MACD_LINE_SIGNAL_CROSS",
    "MACD line/signal crossover",
    "DIRECTIONAL_TRIGGER",
    ["SIGNED_DIRECTIONAL_VALUE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "MACD_HISTOGRAM_ZERO_CROSS",
    "MACD histogram zero crossing",
    "DIRECTIONAL_TRIGGER",
    ["SIGNED_DIRECTIONAL_VALUE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "DMI_DIRECTIONAL_CROSS",
    "DMI directional crossover",
    "DIRECTIONAL_TRIGGER",
    ["BOUNDED_OSCILLATOR", "CATEGORICAL_DIRECTION", "NON_NEGATIVE_MAGNITUDE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(50)),
      short: leaf(o, "crosses_below", constant(50)),
    }),
  ),
  factory(
    "ADX_TREND_STRENGTH_FILTER",
    "ADX trend-strength filter",
    "SHARED_FILTER",
    ["NON_NEGATIVE_MAGNITUDE"],
    "SHARED",
    (o) => ({
      long: leaf(o, ">", constant(20)),
      short: leaf(o, ">", constant(20)),
    }),
  ),
  factory(
    "DONCHIAN_BREAKOUT",
    "Donchian breakout",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL", "BOOLEAN"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "BOLLINGER_BREAKOUT",
    "Bollinger breakout",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL", "RATIO"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(price("1h"), "crosses_above", o),
      short: leaf(price("1h"), "crosses_below", o),
    }),
  ),
  factory(
    "BOLLINGER_REENTRY",
    "Bollinger re-entry",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL", "RATIO"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(price("1h"), "crosses_above", o),
      short: leaf(price("1h"), "crosses_below", o),
    }),
  ),
  factory(
    "SUPERTREND_DIRECTION_CHANGE",
    "Supertrend direction change",
    "DIRECTIONAL_TRIGGER",
    ["CATEGORICAL_DIRECTION"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "==", constant(1)),
      short: leaf(o, "==", constant(-1)),
    }),
  ),
  factory(
    "PRICE_SUPERTREND_CROSS",
    "Price/Supertrend crossover",
    "DIRECTIONAL_TRIGGER",
    ["PRICE_LEVEL"],
    "INVERSE",
    (o) => ({
      long: leaf(price("1h"), "crosses_above", o),
      short: leaf(price("1h"), "crosses_below", o),
    }),
  ),
  factory(
    "RELATIVE_VOLUME_CONFIRMATION",
    "Relative volume confirmation",
    "SHARED_FILTER",
    ["RATIO"],
    "SHARED",
    (o) => ({
      long: leaf(o, ">", constant(1.2)),
      short: leaf(o, ">", constant(1.2)),
    }),
  ),
  factory(
    "RELATIVE_VOLUME_TRIGGER",
    "Relative volume trigger",
    "DIRECTIONAL_TRIGGER",
    ["RATIO"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(1.2)),
      short: leaf(o, "crosses_below", constant(1.2)),
    }),
  ),
  factory(
    "VOLUME_EXPANSION_CONFIRMATION",
    "Volume expansion confirmation",
    "SHARED_FILTER",
    ["VOLUME_LEVEL", "RATIO"],
    "SHARED",
    (o) => ({
      long: leaf(o, ">", constant(1)),
      short: leaf(o, ">", constant(1)),
    }),
  ),
  factory(
    "ATR_VOLATILITY_REGIME_FILTER",
    "ATR volatility regime",
    "REGIME_FILTER",
    ["VOLATILITY_LEVEL", "PRICE_PERCENTAGE"],
    "SHARED",
    (o) => ({
      long: leaf(o, ">", constant(0)),
      short: leaf(o, ">", constant(0)),
    }),
  ),
  factory(
    "BOOLEAN_EVENT",
    "Boolean event",
    "DIRECTIONAL_TRIGGER",
    ["BOOLEAN"],
    "COMPLEMENTARY",
    (o) => ({ long: leaf(o, "is_true"), short: leaf(o, "is_false") }),
  ),
  factory(
    "CALENDAR_MEMBERSHIP_FILTER",
    "Calendar membership",
    "REGIME_FILTER",
    ["CALENDAR_CATEGORY"],
    "SHARED",
    (o) => ({
      long: leaf(o, "==", constant(1)),
      short: leaf(o, "==", constant(1)),
    }),
  ),
  factory(
    "SIGNED_SERIES_CROSS",
    "Signed-series zero crossing",
    "DIRECTIONAL_TRIGGER",
    ["SIGNED_DIRECTIONAL_VALUE", "CUMULATIVE_SERIES", "NORMALIZED_Z_SCORE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "crosses_above", constant(0)),
      short: leaf(o, "crosses_below", constant(0)),
    }),
  ),
  factory(
    "NORMALIZED_FILTER",
    "Normalized ratio filter",
    "SHARED_FILTER",
    ["RATIO", "PERCENTAGE"],
    "SHARED",
    (o) => ({
      long: leaf(o, ">", constant(1)),
      short: leaf(o, ">", constant(1)),
    }),
  ),
  factory(
    "MAGNITUDE_FILTER",
    "Magnitude filter",
    "SHARED_FILTER",
    ["NON_NEGATIVE_MAGNITUDE", "COUNT", "VOLUME_LEVEL", "VOLATILITY_LEVEL"],
    "SHARED",
    (o) => ({
      long: leaf(o, ">", constant(0)),
      short: leaf(o, ">", constant(0)),
    }),
  ),
  factory(
    "CATEGORICAL_STATE",
    "Categorical state",
    "DIRECTIONAL_TRIGGER",
    ["CATEGORICAL_DIRECTION"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, "==", constant(1)),
      short: leaf(o, "==", constant(-1)),
    }),
  ),
  factory(
    "UNBOUNDED_THRESHOLD",
    "Unbounded series threshold",
    "DIRECTIONAL_TRIGGER",
    ["UNBOUNDED_OSCILLATOR", "PRICE_DISTANCE", "PRICE_PERCENTAGE"],
    "COMPLEMENTARY",
    (o) => ({
      long: leaf(o, ">", constant(0)),
      short: leaf(o, "<", constant(0)),
    }),
  ),
];

export const researchTemplateRegistry = Object.fromEntries(
  templates.map((template) => [template.id, template]),
) as Record<string, ResearchTemplate>;
export function getResearchTemplate(id: string) {
  const template = researchTemplateRegistry[id];
  if (!template) throw new Error(`TEMPLATE_IMPLEMENTATION_MISSING:${id}`);
  return template;
}
export function validateTemplateCoverage() {
  for (const [indicator, definition] of Object.entries(indicatorRegistry))
    for (const templateId of definition.templates) {
      const template = getResearchTemplate(templateId);
      if (!template.compatibleSemanticTypes.length)
        throw new Error(`TEMPLATE_SEMANTIC_TYPES_MISSING:${templateId}`);
      if (
        !template.parameterGeneration ||
        !template.operandGeneration ||
        !template.buildLong ||
        !template.buildShort
      )
        throw new Error(`TEMPLATE_INCOMPLETE:${templateId}`);
      if (!indicator || !definition.outputs.length)
        throw new Error(`TEMPLATE_INDICATOR_INVALID:${templateId}`);
    }
  return true;
}
export function buildTemplate(
  templateId: string,
  indicator: string,
  output: string,
  parameters: Record<string, unknown>,
  timeframe: string,
  random: () => number,
): TemplateBuild {
  const template = getResearchTemplate(templateId);
  const metadata = indicatorOutputSemantics(indicator, output);
  if (
    !metadata ||
    !template.compatibleSemanticTypes.includes(metadata.semanticType)
  )
    throw new Error(
      `TEMPLATE_INCOMPATIBLE:${templateId}:${indicator}.${output}`,
    );
  const operand = { ...reference(indicator, parameters, timeframe, output) };
  if (templateId === "DONCHIAN_BREAKOUT" && metadata.semanticType === "BOOLEAN")
    return {
      long: leaf(operand, "is_true"),
      short: leaf(operand, "is_false"),
      directional: true,
      role: template.supportedRole,
    };
  const long = template.buildLong(operand, timeframe, random),
    short = template.buildShort(operand, timeframe, random);
  return {
    long,
    short,
    directional: template.supportedRole === "DIRECTIONAL_TRIGGER",
    role: template.supportedRole,
  };
}
