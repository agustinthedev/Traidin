# Verification run audit

`GET /api/verification-runs/:id/audit` and `npm exec tsx scripts/audit-verification-run.ts <run-id>` reconstruct the balance curve from all persisted trades, compare trades, P&L, costs, profit factor, expectancy and drawdown against the stored report, and verify sequence uniqueness and order.

The audit records `PASS`, `WARNING`, `FAIL`, or `NOT_RECONSTRUCTABLE` on the run, along with its update time. It identifies missing per-trade provenance fields and mismatched engine versions. `FULL_RERUN_REQUIRED` means the historical result is preserved but no longer equivalent to the current engine; `METRICS_RECALCULATION_REQUIRED` is reserved for a reconstructable metrics mismatch.
