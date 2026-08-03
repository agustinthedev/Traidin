# Parameter Robustness

The Full profile runs the exact data snapshot with a baseline and two deterministic period perturbations (80% and 120%). Every numeric `period` in the immutable strategy configuration, including indicator and ATR periods, is rounded to at least two bars before the variant is simulated.

The report compares trade count, net P&L, expectancy, profit factor and drawdown. This is a bounded first robustness pass; it does not claim to be an optimizer or choose parameters based on the future test segment.
