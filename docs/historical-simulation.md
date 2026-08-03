# Historical Simulation

The simulator evaluates trigger candles chronologically. It checks exits before entries, applies adverse slippage and taker fees with `Decimal`, maintains one position per symbol, and records MAE/MFE, holding time and exit reason. Entry and signal-exit fill policies are independently selectable as next execution open, signal close, or the worst observed price; their resolved assumptions are persisted in trade details. Stop/target fills retain their explicit intrabar price and same-bar policy. When local exchange metadata exists, fills are rounded adversely to tick size, quantities are rounded down to step size, and min-quantity/min-notional rejections are recorded in the evaluation funnel. Percentage, ATR, moving-average and confirmed-structure trailing stops ratchet from data observed so far only. Intrabar stop/target conflicts follow the persisted same-bar policy; the safe default is `WORST_CASE` (stop first).

`fundingMode: FIXED` applies `fixedFundingPct` pro-rata to each completed position per eight-hour interval. A positive rate debits longs and credits shorts, and the exact rate, accrued interval count and resulting funding amount are stored in the trade details. `fundingMode: NONE` deliberately emits a report warning rather than silently implying that futures funding was modeled.

Configured long/short exits are evaluated only after intrabar stop and target checks for the same candle. This preserves the conservative fill policy for actual intrabar risk events; if neither fires, the condition exit uses the configured signal-exit fill policy and records `STRATEGY_EXIT`.

The current implementation is intentionally historical only. It does not send orders, connect private streams, create agents, paper-trade, demo-trade or live-trade.
