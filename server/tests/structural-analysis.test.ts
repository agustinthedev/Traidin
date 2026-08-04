import { describe, expect, it } from "vitest";
import { analyzeCandidateAst } from "../strategy/structural-analysis.js";

const ref = {
  type: "indicator",
  indicator: "rsi",
  parameters: { period: 14 },
  timeframe: "1h",
  output: "rsi",
} as const;
describe("structural candidate analysis", () => {
  it("rejects impossible bounded intervals", () => {
    const result = analyzeCandidateAst({
      longEntry: {
        type: "group",
        operator: "AND",
        children: [
          { left: ref, operator: ">", right: { type: "constant", value: 60 } },
          { left: ref, operator: "<", right: { type: "constant", value: 40 } },
        ],
      },
    });
    expect(result.accepted).toBe(false);
    expect(result.rejectionCode).toBe("EMPTY_INTERVAL");
  });
  it("removes dominated bounds and duplicate predicates", () => {
    const result = analyzeCandidateAst({
      longEntry: {
        type: "group",
        operator: "AND",
        children: [
          { left: ref, operator: ">", right: { type: "constant", value: 55 } },
          { left: ref, operator: ">", right: { type: "constant", value: 60 } },
          { left: ref, operator: ">", right: { type: "constant", value: 60 } },
        ],
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.actions.map((action) => action.code)).toContain(
      "DOMINATED_THRESHOLD_REMOVED",
    );
    expect(result.simplifiedNormalizedHash).not.toBe(
      result.originalNormalizedHash,
    );
  });
  it("rejects identical directional rules", () => {
    const node = {
      left: ref,
      operator: ">",
      right: { type: "constant", value: 50 },
    };
    expect(
      analyzeCandidateAst({ longEntry: node, shortEntry: node }).rejectionCode,
    ).toBe("IDENTICAL_DIRECTION_RULES");
  });
  it("does not simplify crossing events as ordinary bounds", () => {
    const result = analyzeCandidateAst({
      longEntry: {
        type: "group",
        operator: "AND",
        children: [
          {
            left: ref,
            operator: "crosses_above",
            right: { type: "constant", value: 60 },
          },
          {
            left: ref,
            operator: "crosses_above",
            right: { type: "constant", value: 40 },
          },
        ],
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.actions).toEqual([]);
  });
});
