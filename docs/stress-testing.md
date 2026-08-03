# Cost and Execution Stress

Standard and Full Verification profiles rerun the exact Strategy Version, candle snapshot, seed and exchange rules under two persisted adverse scenarios: `DOUBLE_FRICTION` doubles configured taker fee and slippage; `SEVERE_FRICTION` uses at least 0.12% taker fee and 8 bps slippage, or a harsher multiple of the baseline assumption.

The report stores each rerun's trade count, net P&L, expectancy, profit factor and maximum drawdown. These are actual historical resimulations, not a post-hoc percentage adjustment.
