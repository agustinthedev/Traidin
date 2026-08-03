# Strategy Model and Versioning

A Strategy is its identity, description and tags. A Strategy Version is an immutable configuration snapshot with a canonical SHA-256 hash, version number, parent reference, registry version and verification state. Editing means publishing a new version; runs always reference the exact version ID and stored hash.

The model supports candle-close triggers, independent long/short nested AND/OR/NOT conditions, ATR/percentage/structure stops, R or percentage targets, fixed notional/equity/risk sizing, volatility-based ATR sizing, leverage and explicit cost/fill assumptions. Trailing policies can follow a percentage, a closed ATR, a closed SMA/EMA (with an optional offset), or confirmed structure; a trail may tighten a stop but never loosen it. The initial reversal policy is close-and-wait.

`VOLATILITY_BASED` sizes the position as configured equity risk divided by the last closed ATR multiplied by `targetAtrMultiple`. Its ATR timeframe must be declared in `requiredTimeframes`; that requirement contributes to pre-run warm-up and cannot silently use unavailable volatility.

`minimumRiskReward` is evaluated from the actual entry, stop and target after their configured policies are resolved. A positive threshold requires a take-profit policy, and a signal below that threshold is counted in the verification funnel as an entry-quality rejection rather than as an omitted trade.

`entryQuality` provides optional, point-in-time filters: maximum extension in closed ATRs from a declared reference; maximum percentage distance from a declared reference; maximum trigger bars since a separately declared breakout condition; and a minimum signed distance to a declared next level (resistance for longs, support for shorts). References and breakout trees use the same validated feature contracts as entries, add their warm-up requirements to the run, and record unavailable features separately from ordinary entry-quality rejections.
