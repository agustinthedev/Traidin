# Slippage model

For a long entry (or short exit), the fill is moved upward by the configured basis points. For a short entry (or long exit), it is moved downward. Exchange tick rounding is then applied in the adverse direction. Gross P&L uses those adjusted fills, so it already contains the slippage effect.

The report stores raw entry/exit prices, adjusted fills, signed per-leg slippage and `slippageImpact`. That last value is informational for reconciliation and cost analysis only; it is not an additional deduction in net P&L. This is versioned with the simulation engine.
