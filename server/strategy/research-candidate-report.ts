import PDFDocument from "pdfkit";

type Row = Record<string, unknown>;
type EquityPoint = { time: number; balance: number };

const pdfGlyphFallbacks: Record<string, string> = {
  "\u00a0": " ",
  "\u2013": "-",
  "\u2014": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
  "\u2192": "->",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u00b1": "+/-",
  "\u00d7": "x",
  "\u221e": "Infinity",
};

const escapeUnsupportedForPdf = (value: unknown) =>
  String(value ?? "-").replace(/[^\x00-\x7E]/g, (character) => {
    const fallback = pdfGlyphFallbacks[character];
    if (fallback) return fallback;
    const codePoint = character.codePointAt(0) ?? 0;
    return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  });

const clean = (value: unknown) =>
  escapeUnsupportedForPdf(value).replace(/[\r\n\t]/g, " ");
const prettyJsonForPdf = (value: unknown) =>
  String(JSON.stringify(value ?? null, null, 2) ?? "null").replace(
    /[^\x00-\x7E]/g,
    (character) => {
      const codeUnit = character.charCodeAt(0);
      return `\\u${codeUnit.toString(16).padStart(4, "0")}`;
    },
  );
const compact = (value: unknown, max = 15) => {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text;
};
const number = (value: unknown, digits = 2) =>
  Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits });
const metricNumber = (value: unknown, digits = 2) =>
  value === "INF" || value === "Infinity"
    ? "Infinity"
    : value == null || !Number.isFinite(Number(value))
      ? "-"
      : number(value, digits);
const date = (value: unknown) => {
  if (!value) return "-";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime())
    ? clean(value)
    : parsed
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC");
};
const metric = (candidate: Row, period: string) =>
  ((candidate.metrics as Row | undefined)?.[period] ?? {}) as Row;
const equity = (candidate: Row, period: string): EquityPoint[] => {
  const points = metric(candidate, period).equity;
  return Array.isArray(points)
    ? points
        .map((point) => ({
          time: Number((point as Row).time),
          balance: Number((point as Row).balance),
        }))
        .filter(
          (point) =>
            Number.isFinite(point.time) && Number.isFinite(point.balance),
        )
        .sort((left, right) => left.time - right.time)
    : [];
};

const candidateReportPayload = (candidate: Row) => {
  const metrics = Object.fromEntries(
    Object.entries((candidate.metrics ?? {}) as Row).map(([period, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return [period, value];
      const { equity: equityCurve, ...summary } = value as Row;
      return [
        period,
        {
          ...summary,
          equityPoints: Array.isArray(equityCurve) ? equityCurve.length : 0,
        },
      ];
    }),
  );
  return {
    humanDescription: candidate.humanDescription ?? null,
    formatterVersion: candidate.formatterVersion ?? "legacy",
    normalizedAst: candidate.normalizedAst,
    configuration: candidate.configuration,
    metrics,
    preflightMetrics: candidate.preflightMetrics,
    rejectionReason: candidate.rejectionReason,
    terminalReason: candidate.terminalReason,
    semanticFingerprint: candidate.semanticFingerprint,
    preflightDiagnostics: candidate.preflightDiagnostics ?? {},
    templateIds: candidate.templateIds ?? [],
    templateVersions: candidate.templateVersions ?? {},
    predicateMetadata: candidate.predicateMetadata ?? [],
    structuralValidation: candidate.structuralValidation ?? null,
    structuralActions: candidate.structuralActions ?? [],
    originalNormalizedHash: candidate.normalizedHash,
    simplifiedNormalizedHash: candidate.simplifiedNormalizedHash ?? null,
    simplifiedNormalizedAst: candidate.simplifiedNormalizedAst ?? null,
    duplicateOfCandidateId: candidate.duplicateOfCandidateId ?? null,
    rejectionStage: candidate.rejectionStage ?? null,
  };
};

export async function researchCandidateReportPdf(input: {
  run: Row;
  candidate: Row;
}) {
  return await new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 40,
      info: {
        Title: `Treidin candidate ${clean(input.candidate.id)}`,
        Author: "Treidin",
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    let page = 1;
    const header = () => {
      document.rect(0, 0, 595, 54).fill("#07111e");
      document
        .fillColor("#b7ff2a")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("TREIDIN - STRATEGY LAB CANDIDATE REPORT", 40, 20);
      document
        .fillColor("#9fb0c2")
        .font("Helvetica")
        .fontSize(8)
        .text(
          `Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
          390,
          23,
          { width: 165, align: "right" },
        );
      document.x = 40;
      document.y = 72;
    };
    const footer = () => {
      document
        .fillColor("#718096")
        .font("Helvetica")
        .fontSize(8)
        .text(`Treidin discovery candidate - page ${page}`, 40, 790, {
          width: 515,
          align: "center",
        });
    };
    const nextPage = () => {
      footer();
      document.addPage();
      page++;
      header();
    };
    const requireSpace = (height: number) => {
      if (document.y + height > 778) nextPage();
    };
    const title = (text: string) => {
      requireSpace(28);
      document.x = 40;
      document
        .moveTo(40, document.y)
        .lineTo(555, document.y)
        .strokeColor("#cbd5e1")
        .lineWidth(0.5)
        .stroke();
      document
        .moveDown(0.55)
        .fillColor("#0f5f9e")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(clean(text), 40, document.y, { lineBreak: false });
      document.moveDown(0.75);
    };
    const fields = (items: Array<[string, unknown]>) => {
      for (const [label, value] of items) {
        requireSpace(17);
        const y = document.y;
        document
          .fillColor("#64748b")
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(clean(label).toUpperCase(), 40, y, {
            width: 185,
            lineBreak: false,
            height: 11,
            ellipsis: true,
          });
        document
          .fillColor("#1f2937")
          .rect(225, y - 3, 330, 14)
          .fill();
        document
          .fillColor("#e2e8f0")
          .font("Helvetica")
          .fontSize(8)
          .text(clean(value), 231, y, {
            width: 318,
            lineBreak: false,
            height: 11,
            ellipsis: true,
          });
        document.y = y + 17;
      }
      document.x = 40;
      document.moveDown(0.45);
    };
    const table = (headers: string[], rows: unknown[][], widths: number[]) => {
      const drawHeader = () => {
        requireSpace(24);
        const y = document.y;
        document.rect(40, y - 3, 515, 17).fill("#0f2742");
        let x = 44;
        headers.forEach((item, index) => {
          document
            .fillColor("#cbd5e1")
            .font("Helvetica-Bold")
            .fontSize(7)
            .text(clean(item), x, y + 2, {
              width: widths[index] - 5,
              lineBreak: false,
              ellipsis: true,
            });
          x += widths[index];
        });
        document.y = y + 19;
      };
      drawHeader();
      rows.forEach((row) => {
        requireSpace(15);
        if (document.y + 15 > 778) {
          nextPage();
          drawHeader();
        }
        const y = document.y;
        let x = 44;
        row.forEach((item, index) => {
          document
            .fillColor("#28394c")
            .font("Helvetica")
            .fontSize(7)
            .text(clean(item), x, y, {
              width: widths[index] - 5,
              lineBreak: false,
              ellipsis: true,
            });
          x += widths[index];
        });
        document
          .strokeColor("#d9e2ef")
          .opacity(0.2)
          .moveTo(40, y + 12)
          .lineTo(555, y + 12)
          .stroke()
          .opacity(1);
        document.y = y + 14;
      });
      document.x = 40;
      document.moveDown(0.5);
    };
    const periods = (input.run.periods ?? {}) as Row;
    const periodRows = ["is", "oos", "holdout"].map((period) => {
      const values = metric(input.candidate, period),
        points = equity(input.candidate, period),
        finalBalance = points.at(-1)?.balance;
      return [
        period.toUpperCase(),
        `${date((periods[period] as Row | undefined)?.start)} to ${date((periods[period] as Row | undefined)?.end)}`,
        values.trades ?? "-",
        metricNumber(values.profitFactor, 3),
        values.return == null ? "-" : `${metricNumber(values.return)}%`,
        values.maxDrawdownPct == null
          ? "-"
          : `${metricNumber(values.maxDrawdownPct)}%`,
        finalBalance == null ? "-" : `$${number(finalBalance)}`,
      ];
    });
    const series = ["is", "oos", "holdout"].flatMap((period) =>
      equity(input.candidate, period),
    );
    const chart = () => {
      if (series.length < 2) return;
      requireSpace(218);
      const top = document.y,
        left = 40,
        width = 515,
        height = 150,
        points = series.sort((a, b) => a.time - b.time),
        values = points.map((point) => point.balance),
        min = Math.min(...values),
        max = Math.max(...values),
        start = points[0]!.time,
        end = points.at(-1)!.time,
        x = (time: number) =>
          left + ((time - start) / Math.max(end - start, 1)) * width,
        y = (value: number) =>
          top + 22 + height - ((value - min) / Math.max(max - min, 1)) * height;
      document
        .fillColor("#64748b")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("STITCHED EQUITY BY EVALUATION PERIOD", left, top);
      const palettes: Record<string, string> = {
        is: "#eaf4ff",
        oos: "#effae3",
        holdout: "#fff5df",
      };
      ["is", "oos", "holdout"].forEach((period) => {
        const current = periods[period] as Row | undefined,
          from = new Date(String(current?.start ?? "")).getTime(),
          to = new Date(String(current?.end ?? "")).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to)) return;
        document
          .rect(x(from), top + 22, Math.max(0, x(to) - x(from)), height)
          .fill(palettes[period]!);
        document
          .strokeColor(
            period === "is"
              ? "#50b7ff"
              : period === "oos"
                ? "#8bbd25"
                : "#d48a18",
          )
          .lineWidth(0.8)
          .moveTo(x(from), top + 22)
          .lineTo(x(from), top + 22 + height)
          .stroke();
        document
          .fillColor("#475569")
          .font("Helvetica-Bold")
          .fontSize(7)
          .text(period.toUpperCase(), x(from) + 4, top + 26);
      });
      document
        .strokeColor("#cbd5e1")
        .lineWidth(0.5)
        .rect(left, top + 22, width, height)
        .stroke();
      points.forEach((point, index) => {
        if (index === 0) document.moveTo(x(point.time), y(point.balance));
        else document.lineTo(x(point.time), y(point.balance));
      });
      document.strokeColor("#82c91e").lineWidth(1.6).stroke();
      document
        .fillColor("#64748b")
        .font("Helvetica")
        .fontSize(7)
        .text(`$${number(max)}`, left, top + 20, { width: 60 })
        .text(`$${number(min)}`, left, top + 22 + height - 4, { width: 60 });
      document.y = top + 192;
    };
    const drawJsonBlock = (payload: unknown) => {
      const lines = prettyJsonForPdf(payload).split("\n");
      let offset = 0;
      while (offset < lines.length) {
        const available = 778 - document.y;
        if (available < 30) {
          nextPage();
          continue;
        }
        const lineHeight = 8;
        const count = Math.max(
          1,
          Math.min(
            lines.length - offset,
            Math.floor((available - 16) / lineHeight),
          ),
        );
        const block = lines.slice(offset, offset + count).join("\n");
        const blockHeight = count * lineHeight + 12;
        document
          .fillColor("#e2e8f0")
          .rect(40, document.y - 3, 515, blockHeight)
          .fill();
        document
          .fillColor("#1f2937")
          .font("Courier")
          .fontSize(7)
          .text(block, 47, document.y + 4, {
            width: 500,
            height: blockHeight - 4,
            lineBreak: false,
          });
        document.y += blockHeight + 8;
        offset += count;
        if (offset < lines.length) nextPage();
      }
    };
    const drawDescription = (value: unknown) => {
      const lines = String(
        value ?? "Description unavailable for this legacy Candidate.",
      )
        .split(/\r?\n/)
        .map((line) => clean(line));
      requireSpace(Math.min(160, lines.length * 12 + 22));
      document
        .fillColor("#64748b")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("HUMAN-READABLE STRATEGY DESCRIPTION", 40, document.y);
      document.moveDown(0.35);
      document
        .fillColor("#1f2937")
        .font("Courier")
        .fontSize(7.5)
        .text(lines.join("\n"), 40, document.y, { width: 515, lineGap: 2 });
      document.moveDown(0.5);
    };
    header();
    document
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(
        `Candidate ${clean(input.candidate.id).slice(0, 8)} - ${clean(input.candidate.family)}`,
      );
    document
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(9)
      .text(
        "Discovery-stage strategy report. This is not a complete Strategy Verifier report.",
      );
    document.moveDown(0.8);
    title("Candidate identity");
    fields([
      ["Research run", input.run.name],
      ["Research run ID", input.run.id],
      [
        "Run status / outcome",
        `${input.run.status ?? "-"} / ${input.run.terminalOutcome ?? "LEGACY"}`,
      ],
      ["Candidate ID", input.candidate.id],
      [
        "Status / rejection",
        `${input.candidate.status ?? "-"} / ${input.candidate.rejectionStage ?? "-"}`,
      ],
      [
        "Family / direction",
        `${input.candidate.family ?? "-"} / ${input.candidate.direction ?? "-"}`,
      ],
      [
        "Complexity / score",
        `${input.candidate.complexityScore ?? "-"} / ${number(input.candidate.score)}`,
      ],
      ["Normalized hash", input.candidate.normalizedHash],
      [
        "Dataset / seed",
        `${(input.run.datasetFingerprint as Row | undefined)?.checksum ?? "-"} / ${input.run.randomSeed ?? "-"}`,
      ],
    ]);
    title("Human-readable strategy");
    drawDescription(input.candidate.humanDescription);
    title("Evaluation performance");
    table(
      [
        "Period",
        "Date range",
        "Trades",
        "PF",
        "Return",
        "Max DD",
        "Final equity",
      ],
      periodRows,
      [52, 160, 46, 46, 56, 58, 97],
    );
    const metricRows = ["is", "oos", "holdout"].map((period) => {
      const values = metric(input.candidate, period);
      return [
        period.toUpperCase(),
        metricNumber(values.profitFactor, 3),
        `${number(values.grossProfit)} / ${number(values.grossLoss)}`,
        `${metricNumber(values.winRate)}%`,
        `${number(values.averageWin)} / ${number(values.averageLoss)}`,
        number(values.expectancy),
        number(values.fees),
        number(values.totalSlippageImpact),
        number(values.totalFunding),
      ];
    });
    title("Stage metric detail");
    table(
      [
        "Period",
        "PF",
        "Gross + / -",
        "Win rate",
        "Avg win / loss",
        "Expectancy",
        "Fees",
        "Slippage",
        "Funding",
      ],
      metricRows,
      [46, 42, 78, 52, 82, 67, 48, 52, 48],
    );
    chart();
    title("Strategy configuration");
    drawJsonBlock(input.candidate.configuration ?? {});
    title("Interpretation and provenance");
    fields([
      [
        "Evaluation method",
        "Chronological IS, OOS and holdout simulations; each period has independently calculated metrics.",
      ],
      [
        "Equity presentation",
        "The chart carries the preceding ending balance into the next period for continuity; it does not alter any period metric.",
      ],
      [
        "Report limitation",
        "Discovery candidates do not persist trade-level detail, Monte Carlo, stress testing or a full verification audit. Promote then run Full Verification for that report.",
      ],
      ["Run configuration hash", input.run.configHash],
      [
        "Simulation / search engine",
        `${input.run.engineVersion ?? "-"} / ${input.run.searchAlgorithmVersion ?? "-"}`,
      ],
    ]);
    footer();
    document.end();
  });
}

export async function researchRunCandidatesReportPdf(input: {
  run: Row;
  candidates: Row[];
}) {
  return await new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 40,
      info: {
        Title: `Treidin Strategy Lab ${clean(input.run.name)}`,
        Author: "Treidin",
      },
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    let page = 1;
    const header = () => {
      document.rect(0, 0, 595, 54).fill("#07111e");
      document
        .fillColor("#b7ff2a")
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("TREIDIN - STRATEGY LAB CANDIDATES REPORT", 40, 20);
      document
        .fillColor("#9fb0c2")
        .font("Helvetica")
        .fontSize(8)
        .text(
          `Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
          390,
          23,
          { width: 165, align: "right" },
        );
      document.x = 40;
      document.y = 72;
    };
    const footer = () => {
      document
        .fillColor("#718096")
        .font("Helvetica")
        .fontSize(8)
        .text(`Treidin Strategy Lab - page ${page}`, 40, 790, {
          width: 515,
          align: "center",
        });
    };
    const nextPage = () => {
      footer();
      document.addPage();
      page++;
      header();
    };
    const requireSpace = (height: number) => {
      if (document.y + height > 778) nextPage();
    };
    const title = (text: string) => {
      requireSpace(28);
      document.x = 40;
      document
        .moveTo(40, document.y)
        .lineTo(555, document.y)
        .strokeColor("#cbd5e1")
        .lineWidth(0.5)
        .stroke();
      document
        .moveDown(0.55)
        .fillColor("#0f5f9e")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(clean(text), 40, document.y, { lineBreak: false });
      document.moveDown(0.75);
    };
    const fields = (items: Array<[string, unknown]>) => {
      for (const [label, value] of items) {
        requireSpace(17);
        const y = document.y;
        document
          .fillColor("#64748b")
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(clean(label).toUpperCase(), 40, y, {
            width: 185,
            lineBreak: false,
            height: 11,
            ellipsis: true,
          });
        document
          .fillColor("#1f2937")
          .rect(225, y - 3, 330, 14)
          .fill();
        document
          .fillColor("#e2e8f0")
          .font("Helvetica")
          .fontSize(8)
          .text(clean(value), 231, y, {
            width: 318,
            lineBreak: false,
            height: 11,
            ellipsis: true,
          });
        document.y = y + 17;
      }
      document.x = 40;
      document.moveDown(0.45);
    };
    const table = (headers: string[], rows: unknown[][], widths: number[]) => {
      const drawHeader = () => {
        requireSpace(24);
        const y = document.y;
        document.rect(40, y - 3, 515, 17).fill("#0f2742");
        let x = 44;
        headers.forEach((item, index) => {
          document
            .fillColor("#cbd5e1")
            .font("Helvetica-Bold")
            .fontSize(7)
            .text(clean(item), x, y + 2, {
              width: widths[index] - 5,
              lineBreak: false,
              ellipsis: true,
            });
          x += widths[index];
        });
        document.y = y + 19;
      };
      drawHeader();
      rows.forEach((row) => {
        requireSpace(15);
        if (document.y + 15 > 778) {
          nextPage();
          drawHeader();
        }
        const y = document.y;
        let x = 44;
        row.forEach((item, index) => {
          document
            .fillColor("#28394c")
            .font("Helvetica")
            .fontSize(7)
            .text(clean(item), x, y, {
              width: widths[index] - 5,
              lineBreak: false,
              ellipsis: true,
            });
          x += widths[index];
        });
        document
          .strokeColor("#d9e2ef")
          .opacity(0.2)
          .moveTo(40, y + 12)
          .lineTo(555, y + 12)
          .stroke()
          .opacity(1);
        document.y = y + 14;
      });
      document.x = 40;
      document.moveDown(0.5);
    };
    const periodValue = (candidate: Row, period: string, field: string) =>
      metric(candidate, period)[field];
    const candidates = [...input.candidates].sort(
      (left, right) =>
        Number(right.score ?? -Infinity) - Number(left.score ?? -Infinity),
    );
    const drawCandidateChart = (candidate: Row, index: number) => {
      const periodNames = ["is", "oos", "holdout"],
        periodPoints = periodNames.map((period) => ({
          period,
          points: equity(candidate, period),
        })),
        available = periodPoints.filter((entry) => entry.points.length > 1);
      if (!available.length) {
        requireSpace(24);
        document
          .fillColor("#64748b")
          .font("Helvetica")
          .fontSize(7)
          .text(
            "Equity curve: no evaluated points persisted for this Candidate.",
          );
        document.moveDown(0.5);
        return;
      }
      const stitched: EquityPoint[] = [],
        periods = (input.run.periods ?? {}) as Row;
      let carriedBalance: number | null = null;
      for (const entry of periodPoints) {
        if (!entry.points.length) continue;
        const first = entry.points[0]!.balance,
          scale: number =
            carriedBalance == null || first === 0 ? 1 : carriedBalance / first;
        const period = periods[entry.period] as Row | undefined,
          start = new Date(String(period?.start ?? "")).getTime(),
          end = new Date(String(period?.end ?? "")).getTime();
        if (carriedBalance != null && Number.isFinite(start))
          stitched.push({ time: start, balance: carriedBalance });
        for (const point of entry.points)
          stitched.push({ time: point.time, balance: point.balance * scale });
        carriedBalance = entry.points.at(-1)!.balance * scale;
        if (Number.isFinite(end))
          stitched.push({ time: end, balance: carriedBalance });
      }
      const points = stitched.sort((left, right) => left.time - right.time),
        values = points.map((point) => point.balance),
        min = Math.min(...values),
        max = Math.max(...values),
        firstPeriod = periods.is as Row | undefined,
        lastPeriod = periods.holdout as Row | undefined,
        chartStart = new Date(
          String(firstPeriod?.start ?? points[0]!.time),
        ).getTime(),
        chartEnd = new Date(
          String(lastPeriod?.end ?? points.at(-1)!.time),
        ).getTime();
      requireSpace(170);
      const top = document.y,
        left = 40,
        width = 515,
        height = 112,
        x = (time: number) =>
          left +
          ((time - chartStart) / Math.max(chartEnd - chartStart, 1)) * width,
        y = (value: number) =>
          top + 19 + height - ((value - min) / Math.max(max - min, 1)) * height;
      document
        .fillColor("#64748b")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(`#${index + 1} EQUITY BY EVALUATION PERIOD`, left, top);
      const palettes: Record<string, string> = {
          is: "#eaf4ff",
          oos: "#effae3",
          holdout: "#fff5df",
        },
        lines: Record<string, string> = {
          is: "#50b7ff",
          oos: "#8bbd25",
          holdout: "#d48a18",
        };
      periodNames.forEach((periodName) => {
        const period = periods[periodName] as Row | undefined,
          from = new Date(String(period?.start ?? "")).getTime(),
          to = new Date(String(period?.end ?? "")).getTime();
        if (!Number.isFinite(from) || !Number.isFinite(to)) return;
        document
          .rect(x(from), top + 19, Math.max(0, x(to) - x(from)), height)
          .fill(palettes[periodName]!);
        document
          .strokeColor(lines[periodName]!)
          .lineWidth(0.8)
          .moveTo(x(from), top + 19)
          .lineTo(x(from), top + 19 + height)
          .stroke();
        document
          .fillColor("#475569")
          .font("Helvetica-Bold")
          .fontSize(6.5)
          .text(periodName.toUpperCase(), x(from) + 4, top + 23);
      });
      document
        .strokeColor("#cbd5e1")
        .lineWidth(0.5)
        .rect(left, top + 19, width, height)
        .stroke();
      points.forEach((point, pointIndex) => {
        if (pointIndex === 0) document.moveTo(x(point.time), y(point.balance));
        else document.lineTo(x(point.time), y(point.balance));
      });
      document.strokeColor("#82c91e").lineWidth(1.35).stroke();
      document
        .fillColor("#64748b")
        .font("Helvetica")
        .fontSize(6.5)
        .text(`$${number(max)}`, left, top + 17, { width: 55 })
        .text(`$${number(min)}`, left, top + 19 + height - 3, { width: 55 });
      document.y = top + 145;
    };
    const drawJsonBlock = (payload: unknown) => {
      const lines = prettyJsonForPdf(payload).split("\n");
      let offset = 0;
      while (offset < lines.length) {
        const available = 778 - document.y;
        if (available < 30) {
          nextPage();
          continue;
        }
        const lineHeight = 8;
        const count = Math.max(
          1,
          Math.min(
            lines.length - offset,
            Math.floor((available - 16) / lineHeight),
          ),
        );
        const block = lines.slice(offset, offset + count).join("\n");
        const blockHeight = count * lineHeight + 12;
        document
          .fillColor("#e2e8f0")
          .rect(40, document.y - 3, 515, blockHeight)
          .fill();
        document
          .fillColor("#1f2937")
          .font("Courier")
          .fontSize(6.5)
          .text(block, 47, document.y + 4, {
            width: 500,
            height: blockHeight - 4,
            lineBreak: false,
          });
        document.y += blockHeight + 8;
        offset += count;
        if (offset < lines.length) nextPage();
      }
    };
    const drawDescription = (value: unknown) => {
      const lines = String(
        value ?? "Description unavailable for this legacy Candidate.",
      )
        .split(/\r?\n/)
        .map((line) => clean(line));
      requireSpace(Math.min(160, lines.length * 12 + 22));
      document
        .fillColor("#64748b")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("HUMAN-READABLE STRATEGY DESCRIPTION", 40, document.y);
      document.moveDown(0.35);
      document
        .fillColor("#1f2937")
        .font("Courier")
        .fontSize(7.5)
        .text(lines.join("\n"), 40, document.y, { width: 515, lineGap: 2 });
      document.moveDown(0.5);
    };

    header();
    document
      .fillColor("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(clean(input.run.name));
    document
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(9)
      .text(
        "Complete discovery export for every persisted Candidate in this Research Run.",
      );
    document.moveDown(0.8);
    title("Research run identity");
    fields([
      ["Research run ID", input.run.id],
      [
        "Symbol / directions",
        `${input.run.symbol ?? "-"} / ${input.run.directions ?? "-"}`,
      ],
      [
        "Trigger / execution",
        `${input.run.triggerTimeframe ?? "-"} / ${input.run.executionTimeframe ?? "-"}`,
      ],
      [
        "Candidate budget / exported",
        `${input.run.candidateBudget ?? "-"} / ${candidates.length}`,
      ],
      [
        "Accepted / evaluated",
        `${input.run.acceptedCandidateCount ?? input.run.generatedCount ?? "-"} / ${input.run.evaluatedCandidateCount ?? "-"}`,
      ],
      [
        "Attempts / raw generated",
        `${input.run.generationAttemptCount ?? "-"} / ${input.run.generatedRawCount ?? "-"}`,
      ],
      ["Generation errors", input.run.generationErrorCount ?? 0],
      [
        "Static / preflight rejected",
        `${input.run.staticRejectedCount ?? "-"} / ${input.run.preflightRejectedCount ?? "-"}`,
      ],
      [
        "Exact / semantic duplicates",
        `${input.run.exactDuplicateCount ?? "-"} / ${input.run.semanticDuplicateCount ?? "-"}`,
      ],
      [
        "IS / OOS / holdout funnel",
        `${input.run.isTestedCount ?? 0} / ${input.run.oosTestedCount ?? 0} / ${input.run.holdoutTestedCount ?? 0}`,
      ],
      [
        "Status / terminal outcome",
        `${input.run.status ?? "-"} / ${input.run.terminalOutcome ?? "LEGACY"}`,
      ],
      [
        "Reconciliation",
        `${input.run.reconciliationStatus ?? "LEGACY"} (${input.run.reconciliationMismatch ?? 0})`,
      ],
      ["Completion message", input.run.completionMessage ?? "-"],
      [
        "Periods",
        `${date(((input.run.periods as Row | undefined)?.is as Row | undefined)?.start)} to ${date(((input.run.periods as Row | undefined)?.holdout as Row | undefined)?.end)}`,
      ],
      ["Configuration hash", input.run.configHash],
      [
        "Dataset fingerprint",
        (input.run.datasetFingerprint as Row | undefined)?.checksum,
      ],
    ]);
    title("All candidates");
    table(
      [
        "#",
        "Candidate",
        "Status",
        "Family",
        "Complexity",
        "IS PF",
        "OOS PF",
        "Holdout PF",
        "Score",
      ],
      candidates.map((candidate, index) => [
        index + 1,
        clean(candidate.id).slice(0, 8),
        compact(candidate.status, 16),
        compact(candidate.family, 15),
        candidate.complexityScore,
        metricNumber(periodValue(candidate, "is", "profitFactor"), 3),
        metricNumber(periodValue(candidate, "oos", "profitFactor"), 3),
        metricNumber(periodValue(candidate, "holdout", "profitFactor"), 3),
        metricNumber(candidate.score),
      ]),
      [25, 58, 82, 75, 55, 54, 60, 70, 76],
    );
    title("Stage diagnostics");
    table(
      [
        "#",
        "IS trades / DD",
        "OOS trades / DD",
        "Holdout trades / DD",
        "Rejection reason",
      ],
      candidates.map((candidate, index) => {
        const is = metric(candidate, "is"),
          oos = metric(candidate, "oos"),
          holdout = metric(candidate, "holdout");
        return [
          index + 1,
          `${is.trades ?? "-"} / ${metricNumber(is.maxDrawdownPct)}%`,
          `${oos.trades ?? "-"} / ${metricNumber(oos.maxDrawdownPct)}%`,
          `${holdout.trades ?? "-"} / ${metricNumber(holdout.maxDrawdownPct)}%`,
          compact(candidate.rejectionReason ?? candidate.terminalReason ?? "-"),
        ];
      }),
      [25, 105, 115, 125, 145],
    );
    requireSpace(450);
    title("Candidate configurations");
    candidates.forEach((candidate, index) => {
      requireSpace(180);
      document.x = 40;
      document
        .fillColor("#0f5f9e")
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          `#${index + 1} ${clean(candidate.id).slice(0, 8)} - ${clean(candidate.family)} - ${clean(candidate.status)}`,
          40,
          document.y,
          { lineBreak: false, ellipsis: true },
        );
      document.y += 14;
      drawDescription(candidate.humanDescription);
      drawCandidateChart(candidate, index);
      requireSpace(24);
      document
        .fillColor("#64748b")
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(
          "JSON PAYLOAD (EQUITY TRAIL SUMMARIZED IN THE CHART ABOVE)",
          40,
          document.y,
        );
      document.moveDown(0.4);
      drawJsonBlock(candidateReportPayload(candidate));
    });
    title("Export notes");
    fields([
      [
        "Metric scope",
        "IS, OOS and holdout metrics are calculated on their respective chronological period.",
      ],
      [
        "Equity scope",
        "The Candidate explorer stitches period curves for visual continuity; the period metrics above remain independent.",
      ],
      [
        "Verification scope",
        "Candidates do not include persisted trade-level data or a full verification audit. Promote a Candidate and run Full Verification for that report.",
      ],
      ["Search engine", input.run.searchAlgorithmVersion],
      ["Random seed", input.run.randomSeed],
    ]);
    footer();
    document.end();
  });
}
