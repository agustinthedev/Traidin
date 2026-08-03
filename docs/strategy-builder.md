# Strategy Builder

The Strategy Verification screen obtains its indicator choices from `GET /api/indicators`, the backend registry source of truth. It creates independent LONG and SHORT entry trees. Each row selects an indicator, period, comparison operator and indicator or constant right-hand operand; rows per direction are composed with an AND or OR group and the whole group can be negated.

Publishing sends the generated condition tree to backend configuration validation. Invalid indicator parameters, omitted required timeframes, unknown outputs and invalid NOT groups are rejected before an immutable Version is created.

The builder also persists the selected stop (ATR or percentage), target (none, R multiple or percentage), trailing policy, sizing model, leverage, maker/taker fees, slippage and funding convention. Sizing can be fixed equity risk or volatility-based: the latter exposes its ATR period and ATR risk multiple, declares the trigger timeframe as a required input, and blocks an entry until that closed-ATR warm-up exists. `FIXED` funding is explicitly expressed as a percentage per eight hours; `NONE` remains visible as an intentional modeling limitation in verification reports.

Long and short exit trees are configured independently. Their rules are evaluated after stop/target intrabar controls on the closed trigger candle, and a successful rule produces the explicit `STRATEGY_EXIT` reason in the simulated trade and replay.

Before queuing a run, **CHECK** invokes `POST /api/strategy-versions/:id/dry-validation`. It returns the immutable hash and execution summary together with configuration errors, per-timeframe completeness and warm-up evidence. The run form records its selected profile, initial balance, deterministic random seed, OOS split and Monte Carlo count in the run snapshot; `CUSTOM` retains those explicit values rather than silently replacing them with profile defaults.
