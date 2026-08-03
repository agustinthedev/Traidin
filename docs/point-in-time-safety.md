# Point-in-Time Safety

Every registry feature is marked point-in-time safe and reproducible from closed candles. The Feature Engine's `asOf` parameter is mandatory for multi-timeframe access. The test suite verifies that a daily candle is not visible until its close.

Features requiring future confirmation must be delayed until confirmation exists. This core does not expose unreconciled pivots or retrospective regime labels as tradeable features. A future swing/fractal implementation must record its availability timestamp rather than backdate it to the pivot candle.
## Pre-run warm-up

Indicators may read only closed candles earlier than the requested start to establish their trailing state. These candles are a read-only feature context, never historical trigger events. This avoids both a cold-start distortion and accidental inclusion of trades before the user-selected range.
