export const VERIFICATION_EXPORT_VERSION = "2026.09.accounting.1";

const csv = (value: unknown) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
export const tradeExportFields = ["run_id", "strategy_version_id", "sequence", "side", "entry_time", "exit_time", "entry_price", "exit_price", "quantity", "gross_pnl", "net_pnl", "fees", "return_pct", "r_multiple", "mae_pct", "mfe_pct", "holding_ms", "entry_reason", "exit_reason", "details_json"] as const;
export const tradeCsvHeader = () => `${tradeExportFields.join(",")}\n`;
export const tradeCsvLine = (runId: string, strategyVersionId: string, row: Record<string, unknown>) => `${tradeExportFields.map((field) => csv(field === "run_id" ? runId : field === "strategy_version_id" ? strategyVersionId : row[field])).join(",")}\n`;
