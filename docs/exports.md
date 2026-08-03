# Exports

`GET /api/verification-runs/:id/trades.csv` returns up to 1,000 persisted simulated trades as RFC-style quoted CSV with entry/exit, quantity, P&L, costs, excursions, holding time and reason codes. The report exposes the same endpoint as **Export CSV**.

`GET /api/strategy-versions/:id/configuration.json` exports the exact immutable configuration snapshot together with its version, parent, registry version and SHA-256 hash. `GET /api/verification-runs/:id/summary.json` exports the persisted run snapshot, linked strategy version, result and structured logs without recomputing a historical report.

Exports are derived from the immutable run record, not a recomputation of the current strategy draft.
# Verification exports

Completed runs expose bounded, local CSV exports: `trades.csv` contains the first 1,000 persisted trades; `metrics.csv` emits scalar report metrics; and `breakdowns.csv` emits every report breakdown as section/key/JSON rows. Download endpoints use only persisted verification data and never include runtime settings, local paths, or credentials.

`GET /api/verification-runs/:id/report.pdf` produces a paginated printable report from the persisted run: identity and configuration snapshot, performance and risk metrics, OOS and Monte Carlo summaries, scorecard, cost-stress table, and the full persisted trade appendix. It is generated locally and contains no credentials or runtime configuration.
