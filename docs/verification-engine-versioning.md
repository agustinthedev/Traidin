# Verification engine versioning

Each run records independent simulation, metrics, Monte Carlo and export versions. A version mismatch is an audit warning and recommends `FULL_RERUN_REQUIRED`; it never changes historical metrics, trades or breakdowns in place.

The current accounting generation is `2026.09.accounting.1`. Earlier runs without Monte Carlo or export version fields are explicitly `LEGACY_UNVERSIONED` in the audit. A rerun creates a new result from the immutable strategy version and its recorded configuration hash.
