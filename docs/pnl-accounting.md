# P&L accounting

Each completed trade stores `grossPnl`, `fees`, `fundingPnl` and `netPnl`. The invariant is `netPnl = grossPnl - fees + fundingPnl`; the closed balance is `initialBalance + sum(netPnl)`. `fees` is the sum of separately persisted entry and exit fees. Positive `fundingPnl` is a credit and negative `fundingPnl` is a debit.

Adverse slippage is applied to entry and exit fill prices before gross P&L is calculated. `slippageImpact` is therefore an explanatory cost estimate and is never subtracted from `grossPnl` or `netPnl` a second time. The simulator does not silently clamp a completed trade loss: if capital is exhausted it stops taking new entries and keeps the accounting identity visible.

Legacy runs may only have a `funding` charge field. Their audit treats it as the inverse signed funding P&L and labels the convention `LEGACY_FUNDING_CHARGE`; no historic result is overwritten.
