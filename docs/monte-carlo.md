# Monte Carlo

Monte Carlo resamples realised trades with a deterministic stored seed. `FIXED_RISK` strategies compound the sampled net R multiple at the configured equity-risk percentage; other sizing models compound the sampled realised net return. This preserves the relation between losses and the capital then at risk instead of repeatedly adding absolute historical P&L.

A path that reaches zero or a non-finite balance is marked as ruined, stops evolving and remains at zero. The report includes shown paths, P5/median/P95 envelopes, final-equity percentiles, max-drawdown percentiles, ruin count, ruin probability and each ruin point. Equity is never negative and drawdown is bounded at -100%.
