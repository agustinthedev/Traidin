# Verification exports

`trades.csv` streams every persisted trade in sequence order; it is not capped at 1,000 rows. It includes run and strategy-version identifiers, execution and P&L fields, and the full `details_json` accounting provenance. `metrics.csv`, `breakdowns.csv`, `summary.json`, immutable configuration JSON, and the PDF report are derived from persisted run data rather than a recomputation of the current draft.

Exports carry the verification export engine version. They contain neither credentials nor runtime paths. Historical exports remain historical: a newer accounting engine can mark a run for rerun but does not change its stored result.
