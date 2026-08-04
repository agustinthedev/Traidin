import {
  indicatorRegistry,
  indicatorOutputSemantics,
  validateIndicator,
} from "./indicators.js";
import {
  strategyConfigSchema,
  type ConditionNode,
  type ResearchRunInput,
  type StrategyConfig,
} from "./model.js";
import { validateCandidateSemantics } from "./research-grammar.js";
import {
  buildTemplate,
  getResearchTemplate,
  validateTemplateCoverage,
} from "./research-templates.js";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => (value = (value * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
function choice<T>(random: () => number, values: readonly T[]) {
  return values[
    Math.min(values.length - 1, Math.floor(random() * values.length))
  ]!;
}
function parametersFor(indicator: string, random: () => number) {
  const definition = indicatorRegistry[indicator]!;
  const values = Object.fromEntries(
    Object.entries(definition.parameters).map(([name, parameter]) => {
      const candidates = [
        parameter.default,
        parameter.min,
        Math.round((parameter.min + parameter.max) / 2),
        parameter.max,
      ].filter((value, index, array) => array.indexOf(value) === index);
      return [
        name,
        parameter.type === "integer"
          ? Math.round(choice(random, candidates))
          : choice(random, candidates),
      ];
    }),
  );
  if (indicator === "macd")
    Object.assign(values, {
      fast: choice(random, [5, 8, 12, 20]),
      slow: choice(random, [26, 34, 50, 100]),
      signal: choice(random, [5, 9, 15]),
    });
  if (indicator === "moving_average_alignment")
    Object.assign(values, { fast: 20, medium: 50, slow: 200 });
  if (indicator === "bollinger")
    values.deviations = choice(random, [1.5, 2, 2.5, 3]);
  if (indicator === "supertrend")
    values.multiple = choice(random, [1, 2, 3, 4]);
  validateIndicator(indicator, values);
  return values;
}

const group = (children: ConditionNode[]): ConditionNode =>
  children.length === 1
    ? children[0]!
    : { type: "group", operator: "AND", children };

export function generateCandidate(
  input: ResearchRunInput,
  index: number,
): {
  config: StrategyConfig;
  family: string;
  rawAst: Record<string, unknown>;
  template: string;
  indicators: string[];
} {
  const random = seeded(input.randomSeed + index * 97),
    timeframe = input.triggerTimeframe,
    direction =
      input.directions === "LONG"
        ? "LONG_ONLY"
        : input.directions === "SHORT"
          ? "SHORT_ONLY"
          : "LONG_AND_SHORT";
  const requestedPrimary =
    input.allowedIndicators[index % input.allowedIndicators.length]!;
  let primary = requestedPrimary;
  if (
    !indicatorRegistry[primary]!.templates.some(
      (id) =>
        getResearchTemplate(id).supportedRole === "DIRECTIONAL_TRIGGER" &&
        primary !== "relative_volume",
    )
  ) {
    primary =
      input.allowedIndicators.find((id) =>
        indicatorRegistry[id]!.templates.some(
          (templateId) =>
            getResearchTemplate(templateId).supportedRole ===
            "DIRECTIONAL_TRIGGER",
        ),
      ) ?? primary;
  }
  const definition = indicatorRegistry[primary]!,
    parameters = parametersFor(primary, random),
    output = choice(random, definition.outputs);
  validateTemplateCoverage();
  const primaryTemplateId = choice(
    random,
    definition.templates.filter(
      (id) =>
        getResearchTemplate(id).supportedRole === "DIRECTIONAL_TRIGGER" &&
        getResearchTemplate(id).compatibleSemanticTypes.includes(
          indicatorOutputSemantics(primary, output).semanticType,
        ),
    ),
  );
  if (!primaryTemplateId)
    throw new Error(`NO_DIRECTIONAL_TEMPLATE:${primary}.${output}`);
  const primaryTemplate = getResearchTemplate(primaryTemplateId);
  let pair = buildTemplate(
    primaryTemplateId,
    primary,
    output,
    parameters,
    timeframe,
    random,
  );
  const template = primaryTemplateId;
  let filterTemplateMetadata: Record<string, unknown> | null = null;
  const filter: { long: ConditionNode; short: ConditionNode } | null =
    index % 3 === 1
      ? (() => {
          const filterIndicator =
            input.allowedIndicators[
              (index + 1) % input.allowedIndicators.length
            ]!;
          const filterDefinition = indicatorRegistry[filterIndicator]!;
          const filterParameters = parametersFor(filterIndicator, random),
            filterOutput = choice(random, filterDefinition.outputs);
          const filterTemplateId = choice(
            random,
            filterDefinition.templates.filter(
              (id) =>
                [
                  "SHARED_FILTER",
                  "CONFIRMATION_FILTER",
                  "REGIME_FILTER",
                ].includes(getResearchTemplate(id).supportedRole) &&
                getResearchTemplate(id).compatibleSemanticTypes.includes(
                  indicatorOutputSemantics(filterIndicator, filterOutput)
                    .semanticType,
                ),
            ),
          );
          if (!filterTemplateId) return null;
          const filterPair = buildTemplate(
            filterTemplateId,
            filterIndicator,
            filterOutput,
            filterParameters,
            timeframe,
            random,
          );
          const filterTemplate = getResearchTemplate(filterTemplateId);
          filterTemplateMetadata = { templateId: filterTemplateId, templateVersion: filterTemplate.version, role: filterTemplate.supportedRole, shared: filterTemplate.supportedRole !== "DIRECTIONAL_TRIGGER", indicator: filterIndicator, output: filterOutput };
          return { long: filterPair.long, short: filterPair.short };
        })()
      : null;
  const longEntry =
    direction === "SHORT_ONLY"
      ? undefined
      : group(filter ? [pair.long, filter.long] : [pair.long]);
  const shortEntry =
    direction === "LONG_ONLY"
      ? undefined
      : group(filter ? [pair.short, filter.short] : [pair.short]);
  const base = {
    exchange: "BINANCE" as const,
    market: "BINANCE_USDM_FUTURES" as const,
    symbols: [input.symbol],
    triggerTimeframe: timeframe,
    executionTimeframe: input.executionTimeframe,
    requiredTimeframes: [...new Set([timeframe, input.executionTimeframe])],
    directions: direction,
    stop: {
      type: "PERCENTAGE" as const,
      percentage: choice(random, [1, 1.5, 2, 3]),
    },
    takeProfit: {
      type: "R_MULTIPLE" as const,
      multiple: choice(random, [1.25, 1.5, 2, 3]),
    },
    sizing: { type: "FIXED_RISK" as const, riskPct: 1 },
    leverage: { fixed: 1, maximum: 1, isolated: true },
    costs: {
      makerFeePct: 0.02,
      takerFeePct: 0.04,
      entryFeeType: "TAKER" as const,
      exitFeeType: "TAKER" as const,
      slippageBps: 2,
      fundingMode: "NONE" as const,
      fixedFundingPct: 0,
      fillModel: "NEXT_OPEN" as const,
      sameBarPolicy: "WORST_CASE" as const,
    },
  };
  let config = strategyConfigSchema.parse({ ...base, longEntry, shortEntry });
  let validation = validateCandidateSemantics(config);
  if (!validation.valid) {
    const fallbackIndicator =
      input.allowedIndicators.find((id) =>
        indicatorRegistry[id]!.outputs.some(
          (candidateOutput) =>
            indicatorOutputSemantics(id, candidateOutput).semanticType ===
            "PRICE_LEVEL",
        ),
      ) ?? "ema";
    const fallbackParameters = parametersFor(fallbackIndicator, random),
      fallbackOutput =
        indicatorRegistry[fallbackIndicator]!.outputs.find(
          (candidateOutput) =>
            indicatorOutputSemantics(fallbackIndicator, candidateOutput)
              .semanticType === "PRICE_LEVEL",
        ) ?? indicatorRegistry[fallbackIndicator]!.outputs[0]!;
    const fallbackTemplateId = indicatorRegistry[
      fallbackIndicator
    ]!.templates.find(
      (id) => id === "PRICE_MA_CROSSOVER" || id === "PRICE_ABOVE_BELOW_MA",
    )!;
    pair = buildTemplate(
      fallbackTemplateId,
      fallbackIndicator,
      fallbackOutput,
      fallbackParameters,
      timeframe,
      random,
    );
    const fallbackLong = direction === "SHORT_ONLY" ? undefined : pair.long,
      fallbackShort = direction === "LONG_ONLY" ? undefined : pair.short;
    config = strategyConfigSchema.parse({
      ...base,
      longEntry: fallbackLong,
      shortEntry: fallbackShort,
    });
    validation = validateCandidateSemantics(config);
  }
  if (!validation.valid)
    throw new Error(
      `Generated invalid candidate ${primary}: ${validation.errors.join("; ")}`,
    );
  const rawAst = {
    longEntry: config.longEntry,
    shortEntry: config.shortEntry,
    stop: config.stop,
    takeProfit: config.takeProfit,
    sizing: config.sizing,
    template,
    templateIds: [primaryTemplateId, ...(filterTemplateMetadata?.templateId ? [String(filterTemplateMetadata.templateId)] : [])],
    templateVersions: { [primaryTemplateId]: primaryTemplate.version, ...(filterTemplateMetadata?.templateId ? { [String(filterTemplateMetadata.templateId)]: String(filterTemplateMetadata.templateVersion) } : {}) },
    predicateMetadata: [
      {
        templateId: primaryTemplateId,
        templateVersion: primaryTemplate.version,
        role: primaryTemplate.supportedRole,
        shared: primaryTemplate.supportedRole !== "DIRECTIONAL_TRIGGER",
        indicator: primary,
        output,
      },
      ...(filterTemplateMetadata ? [filterTemplateMetadata] : []),
    ],
    indicators: [
      primary,
      ...(filter
        ? [
            input.allowedIndicators[
              (index + 1) % input.allowedIndicators.length
            ]!,
          ]
        : []),
    ],
  };
  return {
    config,
    family: requestedPrimary.toUpperCase(),
    rawAst,
    template,
    indicators: rawAst.indicators as string[],
  };
}
