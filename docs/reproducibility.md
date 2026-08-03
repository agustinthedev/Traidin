# Reproducibility

Each run persists strategy version ID, immutable configuration hash, registry version, simulation and metrics versions, selected and actual ranges, seed, cost/fill assumptions and a logical data fingerprint. The fingerprint includes per-timeframe count, first/last closed candle, gap count and completeness plus a checksum.

Reports are stored as results, not recalculated on read. A data repair or a later Strategy Version therefore cannot silently mutate an old report; rerun or clone creates new evidence.
# Reproducibility and data revisions

Every run preserves its version hash, engine versions, seed and logical candle fingerprint. `GET /api/verification-runs/:id/reproducibility` compares the stored frame snapshot (and, for current runs, warm-up context) with the current local dataset without mutating the historic report. A reported difference is an audit signal, not a silent report rewrite. `POST /api/verification-runs/:id/clone` creates a fresh queued rerun with the current fingerprint after rechecking completeness and warm-up.
