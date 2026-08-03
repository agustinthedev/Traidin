export function equityChartDomain(values: number[], allowsNegativeEquity = false) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  const low = Math.min(...finite), high = Math.max(...finite), padding = Math.max((high - low) * .08, 1);
  const min = allowsNegativeEquity ? low - padding : Math.max(0, low - padding);
  return { min, max: Math.max(min + 1, high + padding) };
}
