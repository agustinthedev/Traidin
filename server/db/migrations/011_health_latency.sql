-- Keep the health endpoint bounded on large candle histories.
CREATE INDEX IF NOT EXISTS candles_persisted_at_idx ON candles(persisted_at);
