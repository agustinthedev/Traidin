ALTER TABLE gaps ADD COLUMN downloaded_candles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gaps ADD COLUMN persisted_candles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gaps ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gaps ADD COLUMN checkpoint_time INTEGER;
ALTER TABLE gaps ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

UPDATE gaps SET updated_at = detected_at WHERE updated_at = 0;

CREATE INDEX IF NOT EXISTS gaps_status_updated_idx ON gaps(status, updated_at);
CREATE INDEX IF NOT EXISTS candles_incomplete_timeframe_time_idx ON candles(timeframe, is_complete, open_time);
