# Indicator Registry

`server/strategy/indicators.ts` is the single backend source of truth for indicator metadata, parameters, outputs, warm-up and visualization hints. The API exposes it at `GET /api/indicators`; the dashboard never defines a second parameter schema.

The current production core covers moving averages, MACD, ADX/+DI/-DI, Supertrend, regression and moving-average trend features; RSI, Stochastic RSI, ROC, Momentum, CCI and Williams %R; True Range/ATR, Bollinger, Keltner, choppiness and rolling volatility; volume/trade-count statistics, MFI, CMF, ADL, OBV and VPT; candle-level taker-flow proxies; Donchian/high-low structure; return distributions, percentile, autocorrelation and drawdown; and UTC calendar features. Analytical series use `Float64Array` for throughput. This is deliberately separate from fills, quantity and P&L, which use `Decimal`.

Taker indicators are candle proxies derived from Binance kline fields. They are not footprint or complete order-flow measurements.

`ADX` uses Wilder smoothing. `ATR` and the channel features use the documented closed-candle series and expose every component as a named output. Calendar flags are derived exclusively from each closed candle's UTC close timestamp. Statistical indicators use trailing windows; unavailable warm-up samples remain `NaN` and the Feature Engine rejects them instead of treating them as signals.
