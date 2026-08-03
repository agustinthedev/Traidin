# Feature Engine

`FeatureEngine` loads only `is_closed=1 AND is_complete=1` candles. It calculates each requested feature once per `(indicator, sorted parameters, timeframe)` and keeps the resulting typed arrays in memory inside a verification worker, never in the browser.

`value(request, asOf)` uses binary search to select the last candle whose `closeTime <= asOf`. Multi-timeframe conditions therefore see the latest already-closed daily/weekly candle, never the candle that is still forming. Values before `warmupBars` are `NaN` and conditions reject them with `FEATURE_UNAVAILABLE_OR_WARMUP`.
## Warm-up context

Before a verification run, the configuration is traversed to derive the maximum required closed-candle warm-up per timeframe. The worker loads that earlier context into the Feature Engine, but passes the requested run window to the simulator, so no pre-range candle can create a trade or affect reported P&L. The availability API reports the required and available warm-up counts and blocks a run when the context is missing.
