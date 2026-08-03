export const WALK_FORWARD_POLICY_VERSION = "2026.09.eligible-selection.1";

export const defaultWalkForwardEligibility = {
  minimumTrainingTrades: 30,
  minimumProfitFactor: 1,
  requirePositiveNetProfit: true,
  maximumDrawdownPct: 50,
};

export type WalkForwardMetric = { tradeCount: number; netProfit: number; profitFactor: number | null; maxDrawdownPct: number };

export function walkForwardEligibility(metrics: WalkForwardMetric, policy = defaultWalkForwardEligibility) {
  const reasons: string[] = [];
  if (metrics.tradeCount < policy.minimumTrainingTrades) reasons.push(`MIN_TRAINING_TRADES_${policy.minimumTrainingTrades}`);
  if (policy.requirePositiveNetProfit && metrics.netProfit <= 0) reasons.push("NON_POSITIVE_TRAINING_NET_PROFIT");
  if ((metrics.profitFactor ?? 0) < policy.minimumProfitFactor) reasons.push(`PROFIT_FACTOR_BELOW_${policy.minimumProfitFactor}`);
  if (Math.abs(metrics.maxDrawdownPct) > policy.maximumDrawdownPct) reasons.push(`MAX_DRAWDOWN_ABOVE_${policy.maximumDrawdownPct}`);
  return { eligible: reasons.length === 0, reasons, policy };
}

export function selectWalkForwardCandidate<T extends { periodMultiplier: number; metrics: WalkForwardMetric }>(candidates: T[]) {
  const evaluated = candidates.map((candidate) => ({ ...candidate, eligibility: walkForwardEligibility(candidate.metrics) }));
  const eligible = evaluated.filter((candidate) => candidate.eligibility.eligible);
  const selected = [...eligible].sort((left, right) => right.metrics.netProfit - left.metrics.netProfit || (right.metrics.profitFactor ?? 0) - (left.metrics.profitFactor ?? 0) || left.metrics.maxDrawdownPct - right.metrics.maxDrawdownPct)[0] ?? null;
  return { candidates: evaluated, selected, policy: defaultWalkForwardEligibility };
}
