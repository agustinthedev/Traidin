# Binance USDⓈ-M kline payload analysis

Investigated on 2026-08-01 against the official production public stream without credentials.

## Stream and evidence

- Stream: `{symbol}@kline_{interval}`.
- Verified combined endpoint: `wss://fstream.binance.com/market/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m`.
- Official reference: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market
- Update cadence: up to 250 ms when trades exist.
- Legacy paths accepted a handshake in this environment but yielded no frames; the current `/market/stream` route produced real BTCUSDT and ETHUSDT frames and is configurable.

Real public open-candle sample:

```json
{"stream":"btcusdt@kline_1m","data":{"e":"kline","E":1785617898970,"s":"BTCUSDT","k":{"t":1785617880000,"T":1785617939999,"s":"BTCUSDT","i":"1m","f":7946184667,"L":7946184938,"o":"62635.80","c":"62631.80","h":"62635.90","l":"62631.80","v":"3.418","n":272,"x":false,"q":"214085.65360","V":"0.491","Q":"30753.74630","B":"0"}}}
```

## Field decisions

| Path | Type | Meaning | Decision / model |
|---|---|---|---|
| `stream` | string | combined route | operational only |
| `data.e` | string | event type | validate |
| `data.E` | int64 ms | exchange event time | persist `event_time` |
| `data.s`, `k.s` | string | symbol | cross-validate; persist `symbol` |
| `k.t`, `k.T` | int64 ms | open/inclusive close time | persist |
| `k.i` | string | interval | persist `timeframe` |
| `k.f`, `k.L` | int64 | first/last trade IDs | persist for audit |
| `k.o/h/l/c` | decimal string | OHLC | persist as SQLite `TEXT`, calculate with exact Decimal |
| `k.v`, `k.q` | decimal string | base/quote volume | persist |
| `k.n` | int64 | trade count | persist |
| `k.x` | boolean | definitive close | persist; live ingestion finalizes only when true |
| `k.V`, `k.Q` | decimal string | taker-buy volumes | persist |
| `k.B` | string | documented as ignore | accept then omit |

The normalized typed candle is canonical; raw payload retention is optional, sanitized, and not the only representation. REST rows carry the same economic fields but not WebSocket event time or trade-ID range. `received_at` and `persisted_at` are local audit timestamps.
