import PDFDocument from "pdfkit";

type Row = Record<string, unknown>;
type EquityPoint = { time: number; balance: number };

const clean = (value: unknown) => String(value ?? "-").replace(/[^\x20-\x7E]/g, "?");
const number = (value: unknown, digits = 2) => Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits });
const metricNumber = (value: unknown, digits = 2) => value == null || !Number.isFinite(Number(value)) ? "-" : number(value, digits);
const date = (value: unknown) => {
  if (!value) return "-";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? clean(value) : parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
};
const metric = (candidate: Row, period: string) => ((candidate.metrics as Row | undefined)?.[period] ?? {}) as Row;
const equity = (candidate: Row, period: string): EquityPoint[] => {
  const points = metric(candidate, period).equity;
  return Array.isArray(points) ? points.map((point) => ({ time: Number((point as Row).time), balance: Number((point as Row).balance) })).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.balance)).sort((left, right) => left.time - right.time) : [];
};

export async function researchCandidateReportPdf(input: { run: Row; candidate: Row }) {
  return await new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 40, info: { Title: `Treidin candidate ${clean(input.candidate.id)}`, Author: "Treidin" } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    let page = 1;
    const header = () => { document.rect(0, 0, 595, 54).fill("#07111e"); document.fillColor("#b7ff2a").font("Helvetica-Bold").fontSize(13).text("TREIDIN - STRATEGY LAB CANDIDATE REPORT", 40, 20); document.fillColor("#9fb0c2").font("Helvetica").fontSize(8).text(`Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`, 390, 23, { width: 165, align: "right" }); document.x = 40; document.y = 72; };
    const footer = () => { document.fillColor("#718096").font("Helvetica").fontSize(8).text(`Treidin discovery candidate - page ${page}`, 40, 790, { width: 515, align: "center" }); };
    const nextPage = () => { footer(); document.addPage(); page++; header(); };
    const requireSpace = (height: number) => { if (document.y + height > 778) nextPage(); };
    const title = (text: string) => { requireSpace(28); document.moveTo(40, document.y).lineTo(555, document.y).strokeColor("#cbd5e1").lineWidth(.5).stroke(); document.moveDown(.55).fillColor("#0f5f9e").font("Helvetica-Bold").fontSize(12).text(clean(text)); document.moveDown(.35); };
    const fields = (items: Array<[string, unknown]>) => { for (const [label, value] of items) { requireSpace(17); const y = document.y; document.fillColor("#64748b").font("Helvetica-Bold").fontSize(8).text(clean(label).toUpperCase(), 40, y, { width: 185 }); document.fillColor("#1f2937").rect(225, y - 3, 330, 14).fill(); document.fillColor("#e2e8f0").font("Helvetica").fontSize(8).text(clean(value), 231, y, { width: 318, ellipsis: true }); document.y = y + 17; } document.moveDown(.45); };
    const table = (headers: string[], rows: unknown[][], widths: number[]) => { const drawHeader = () => { requireSpace(24); const y = document.y; document.rect(40, y - 3, 515, 17).fill("#0f2742"); let x = 44; headers.forEach((item, index) => { document.fillColor("#cbd5e1").font("Helvetica-Bold").fontSize(7).text(clean(item), x, y + 2, { width: widths[index] - 5, ellipsis: true }); x += widths[index]; }); document.y = y + 19; }; drawHeader(); rows.forEach((row) => { requireSpace(15); if (document.y + 15 > 778) { nextPage(); drawHeader(); } const y = document.y; let x = 44; row.forEach((item, index) => { document.fillColor("#28394c").font("Helvetica").fontSize(7).text(clean(item), x, y, { width: widths[index] - 5, ellipsis: true }); x += widths[index]; }); document.strokeColor("#d9e2ec").opacity(.2).moveTo(40, y + 12).lineTo(555, y + 12).stroke().opacity(1); document.y = y + 14; }); document.moveDown(.5); };
    const periods = (input.run.periods ?? {}) as Row;
    const periodRows = ["is", "oos", "holdout"].map((period) => {
      const values = metric(input.candidate, period), points = equity(input.candidate, period), finalBalance = points.at(-1)?.balance;
      return [period.toUpperCase(), `${date((periods[period] as Row | undefined)?.start)} to ${date((periods[period] as Row | undefined)?.end)}`, values.trades ?? "-", metricNumber(values.profitFactor, 3), values.return == null ? "-" : `${metricNumber(values.return)}%`, values.maxDrawdownPct == null ? "-" : `${metricNumber(values.maxDrawdownPct)}%`, finalBalance == null ? "-" : `$${number(finalBalance)}`];
    });
    const series = ["is", "oos", "holdout"].flatMap((period) => equity(input.candidate, period));
    const chart = () => {
      if (series.length < 2) return;
      requireSpace(218);
      const top = document.y, left = 40, width = 515, height = 150, points = series.sort((a, b) => a.time - b.time), values = points.map((point) => point.balance), min = Math.min(...values), max = Math.max(...values), start = points[0]!.time, end = points.at(-1)!.time, x = (time: number) => left + (time - start) / Math.max(end - start, 1) * width, y = (value: number) => top + 22 + height - (value - min) / Math.max(max - min, 1) * height;
      document.fillColor("#64748b").font("Helvetica-Bold").fontSize(8).text("STITCHED EQUITY BY EVALUATION PERIOD", left, top);
      const palettes: Record<string, string> = { is: "#eaf4ff", oos: "#effae3", holdout: "#fff5df" };
      ["is", "oos", "holdout"].forEach((period) => { const current = periods[period] as Row | undefined, from = new Date(String(current?.start ?? "")).getTime(), to = new Date(String(current?.end ?? "")).getTime(); if (!Number.isFinite(from) || !Number.isFinite(to)) return; document.rect(x(from), top + 22, Math.max(0, x(to) - x(from)), height).fill(palettes[period]!); document.strokeColor(period === "is" ? "#50b7ff" : period === "oos" ? "#8bbd25" : "#d48a18").lineWidth(.8).moveTo(x(from), top + 22).lineTo(x(from), top + 22 + height).stroke(); document.fillColor("#475569").font("Helvetica-Bold").fontSize(7).text(period.toUpperCase(), x(from) + 4, top + 26); });
      document.strokeColor("#cbd5e1").lineWidth(.5).rect(left, top + 22, width, height).stroke();
      points.forEach((point, index) => { if (index === 0) document.moveTo(x(point.time), y(point.balance)); else document.lineTo(x(point.time), y(point.balance)); });
      document.strokeColor("#82c91e").lineWidth(1.6).stroke(); document.fillColor("#64748b").font("Helvetica").fontSize(7).text(`$${number(max)}`, left, top + 20, { width: 60 }).text(`$${number(min)}`, left, top + 22 + height - 4, { width: 60 }); document.y = top + 192;
    };

    header();
    document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(20).text(`Candidate ${clean(input.candidate.id).slice(0, 8)} - ${clean(input.candidate.family)}`);
    document.fillColor("#64748b").font("Helvetica").fontSize(9).text("Discovery-stage strategy report. This is not a complete Strategy Verifier report."); document.moveDown(.8);
    title("Candidate identity");
    fields([["Research run", input.run.name], ["Research run ID", input.run.id], ["Candidate ID", input.candidate.id], ["Status / rejection", `${input.candidate.status ?? "-"} / ${input.candidate.rejectionStage ?? "-"}`], ["Family / direction", `${input.candidate.family ?? "-"} / ${input.candidate.direction ?? "-"}`], ["Complexity / score", `${input.candidate.complexityScore ?? "-"} / ${number(input.candidate.score)}`], ["Normalized hash", input.candidate.normalizedHash], ["Dataset / seed", `${(input.run.datasetFingerprint as Row | undefined)?.checksum ?? "-"} / ${input.run.randomSeed ?? "-"}`]]);
    title("Evaluation performance");
    table(["Period", "Date range", "Trades", "PF", "Return", "Max DD", "Final equity"], periodRows, [52, 160, 46, 46, 56, 58, 97]);
    chart();
    title("Strategy configuration");
    const configuration = JSON.stringify(input.candidate.configuration ?? {}, null, 2);
    requireSpace(Math.min(300, configuration.length / 70 * 8 + 25)); document.fillColor("#e2e8f0").rect(40, document.y - 3, 515, Math.min(280, configuration.length / 70 * 8 + 16)).fill(); document.fillColor("#1f2937").font("Courier").fontSize(7).text(clean(configuration), 47, document.y + 4, { width: 500, height: 260, ellipsis: true }); document.moveDown(1);
    title("Interpretation and provenance");
    fields([["Evaluation method", "Chronological IS, OOS and holdout simulations; each period has independently calculated metrics."], ["Equity presentation", "The chart carries the preceding ending balance into the next period for continuity; it does not alter any period metric."], ["Report limitation", "Discovery candidates do not persist trade-level detail, Monte Carlo, stress testing or a full verification audit. Promote then run Full Verification for that report."], ["Run configuration hash", input.run.configHash], ["Simulation / search engine", `${input.run.engineVersion ?? "-"} / ${input.run.searchAlgorithmVersion ?? "-"}`]]);
    footer();
    document.end();
  });
}
