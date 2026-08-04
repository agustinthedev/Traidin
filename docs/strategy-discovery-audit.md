# Strategy discovery audit

## Scope

This audit follows a Research Run from the dashboard/API request through indicator calculation, candidate generation, static validation, empirical preflight, IS/OOS/holdout simulation, persistence, promotion and PDF export. It applies to new semantic-grammar runs; persisted legacy runs retain their stored AST and are labelled with their original registry/generator version.

## Previous behavior and root causes

- `ResearchWorker` used one generic sampler (`2..500`) for nearly every parameter and selected arbitrary outputs/constants. This produced `ADX > 0`, `ATR > 0`, `MFI > 0`, volume sign tests, invalid Supertrend direction comparisons and impossible MACD/Bollinger/Supertrend values.
- The loop stopped after `candidateBudget` attempts, so invalid and duplicate attempts consumed the requested budget. A run could therefore export fewer candidates without explaining the shortfall.
- Complexity was calculated over a flat AST that normally contained only one long and one short predicate. It did not describe meaningful composition.
- Candidates were inserted as `GENERATED` before evaluation and finalization did not reconcile finalists or transient rows.
- Quality rejection was stored as one generic `QUALITY_FILTER`, without stage-specific diagnostics.
- The report JSON sanitizer replaced newlines and tabs with `?`, making valid JSON look malformed.

## Architectural changes

`server/strategy/indicators.ts` is now a typed semantics registry. Every output has a semantic type, bounds where applicable, sign/scale flags, valid operators/operands, roles and normalization hints. Parameter overrides and relational constraints are centralized; registry validation fails at module startup if metadata is incomplete.

`server/strategy/research-generator.ts` uses deterministic, seeded templates. Price-level outputs use price crosses, oscillators use bounded complementary thresholds, directional states use state equality, and non-directional volume/volatility features are filters attached to a real directional trigger. MACD ordering, Bollinger deviations and Supertrend ranges are enforced before a candidate can be emitted. Some candidates include a second condition, so complexity reflects actual predicates.

`server/strategy/research-grammar.ts` performs typed static validation and reference-period preflight. It rejects incompatible operands, categorical/price comparisons, out-of-range constants, naive non-negative sign pairs, identical long/short rules, missing directional triggers, unreachable signals and constant signal series.

`server/strategy/research-normalization.ts` canonicalizes nested commutative groups and exposes stable normalized and semantic fingerprints. The worker tracks exact and empirical duplicates separately.

## Budget and lifecycle

`candidateBudget` means valid, unique candidates accepted for evaluation. Invalid attempts and duplicates do not consume it. `maxGenerationAttempts` provides a finite exhaustion boundary. The run stores attempt, raw, static, preflight, duplicate, accepted, evaluated and unevaluated counters plus an exhaustion reason.

Candidates carry validation/preflight diagnostics, stage rejection codes, terminal reasons, grammar/registry/generator versions, semantic fingerprints and human-readable provenance. Finalization converts unselected finalists and any unreconciled transient rows to explicit terminal rejection/failure states before marking the run complete.

## Evaluation and lookahead findings

IS, OOS and holdout are simulated independently with the prior stage's ending balance as the next stage's starting balance. OOS and holdout starts are exclusive to prevent a boundary candle from being counted twice. Feature access remains point-in-time and uses only closed candles; Donchian breakout calculations use a prior window. Execution fills use the next valid execution candle for a closed trigger.

Stage gates are resolved independently (`qualityGates.is`, `.oos`, `.holdout`) and rejection codes are persisted as `IS_MIN_TRADES`, `OOS_PROFIT_FACTOR`, `HOLDOUT_MAX_DRAWDOWN`, etc. Metrics include trade count beside PF and retain gross/net costs, funding and slippage fields from the accounting engine.

## Persistence, UI and exports

Migration `009_research_discovery_audit.sql` adds backward-compatible run/candidate diagnostics and provenance columns. The API maps these fields while preserving legacy rows. The create-run payload accepts per-stage quality gates. The candidate report keeps pretty-printed JSON (including line breaks) and includes stitched period charts.

## Extension instructions

To add an indicator:

1. Add its closed-candle calculation and stable output names.
2. Add parameter bounds and relational constraints in the registry override table.
3. Assign semantic metadata for every output, including bounds and valid operands/operators.
4. Add a generator template or deliberately classify it as a filter-only feature.
5. Add registry, parameter, semantic-validation, preflight and lookahead tests.
6. Bump `INDICATOR_REGISTRY_VERSION` and keep old candidate configurations immutable.

## Known limitations

The current candidate grammar intentionally keeps exit generation conservative (fixed percentage stop plus fixed R take-profit); the typed strategy model already supports ATR/structure/trailing policies for future templates. Empirical preflight is a fast signal sanity check, not a substitute for the full simulator. Legacy runs cannot be retroactively reclassified because doing so would silently reinterpret persisted research.
## Research worker ownership and audit policy

Research workers use an atomic `(research_run_id, worker_id, claim_token, lease)` ownership tuple. Heartbeats, progress, candidate writes, stage metrics, generation-attempt rows, and terminal transitions are conditional on that tuple; a stale worker receives `STALE_WORKER_OWNERSHIP` and stops without retrying under the old claim.

An expired lease is not silently re-executed. The watchdog marks the run `FAILED` with `WORKER_LEASE_EXPIRED`; an operator must explicitly launch the failed run again. `reclaimExpired` is an explicit recovery action used by the race tests. A worker process restart does not reclaim terminal `FAILED`, `CANCELLED`, or `COMPLETED` runs.

Every generation attempt is durable and must reconcile as `generation attempts = generation errors + raw generated`, with raw generated partitioned into named terminal categories. A mismatch is persisted as `MISMATCH` and prevents a normal completion outcome.

Discovery fingerprints include requested and context ranges, required/actual warmup bars, missing bars, timeframe alignment, split boundaries, and warmup policy version. Context initializes indicators but is excluded from stage P&L windows.
