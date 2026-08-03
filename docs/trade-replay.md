# Trade Replay

The verification report persists each simulated fill. Selecting a trade calls `GET /api/verification-runs/:id/replay?sequence=N`, which returns a bounded closed-candle window around that trade, entry/exit details and the overlay indicators referenced by the immutable Strategy Version.

The browser receives only that replay window (default 180 execution-timeframe bars on either side), never the full verification history. The interactive chart marks entry and exit, shows the strategy's overlay features by default, supports built-in pan/zoom and is centered on the selected trade. Each overlay can be toggled independently; `LOAD MORE CONTEXT` requests a larger bounded window (doubling to a hard maximum of 2,000 bars) only when the user asks for it.
