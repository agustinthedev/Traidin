CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS candles (
  id TEXT PRIMARY KEY,
  exchange TEXT NOT NULL,
  market TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  open_time INTEGER NOT NULL,
  close_time INTEGER NOT NULL,
  open TEXT NOT NULL,
  high TEXT NOT NULL,
  low TEXT NOT NULL,
  close TEXT NOT NULL,
  volume TEXT NOT NULL,
  quote_volume TEXT NOT NULL,
  trade_count INTEGER NOT NULL CHECK (trade_count >= 0),
  taker_buy_base_volume TEXT NOT NULL,
  taker_buy_quote_volume TEXT NOT NULL,
  first_trade_id INTEGER,
  last_trade_id INTEGER,
  is_closed INTEGER NOT NULL CHECK (is_closed IN (0, 1)),
  is_complete INTEGER NOT NULL CHECK (is_complete IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('WEBSOCKET','REST_BACKFILL','REST_GAP_REPAIR','LOCAL_AGGREGATION')),
  event_time INTEGER,
  received_at INTEGER NOT NULL,
  persisted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(exchange, market, symbol, timeframe, open_time)
);
CREATE INDEX IF NOT EXISTS candles_symbol_timeframe_time_idx ON candles(symbol, timeframe, open_time);
CREATE INDEX IF NOT EXISTS candles_source_idx ON candles(source);
CREATE INDEX IF NOT EXISTS candles_complete_symbol_idx ON candles(is_complete, symbol, timeframe, open_time);

CREATE TABLE IF NOT EXISTS backfill_jobs (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL DEFAULT 'BINANCE_USDM_FUTURES',
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER,
  until_now INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','PAUSED','CANCELLING','CANCELLED','COMPLETED','FAILED')),
  estimated_candles INTEGER NOT NULL DEFAULT 0,
  downloaded_candles INTEGER NOT NULL DEFAULT 0,
  persisted_candles INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  checkpoint_time INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS backfill_jobs_status_created_idx ON backfill_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS gaps (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL DEFAULT 'BINANCE_USDM_FUTURES',
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  gap_start INTEGER NOT NULL,
  gap_end INTEGER NOT NULL,
  expected_candles INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DETECTED','REPAIRING','REPAIRED','FAILED')),
  detected_at INTEGER NOT NULL,
  repair_started_at INTEGER,
  repaired_at INTEGER,
  repair_job_id TEXT,
  error_message TEXT,
  UNIQUE(market, symbol, timeframe, gap_start, gap_end)
);
CREATE INDEX IF NOT EXISTS gaps_status_symbol_idx ON gaps(status, symbol, timeframe);

CREATE TABLE IF NOT EXISTS system_events (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  event_type TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT,
  job_id TEXT,
  duration_ms INTEGER,
  rows_affected INTEGER,
  queue_depth INTEGER,
  error_code TEXT,
  message TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS system_events_timestamp_idx ON system_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS system_events_filter_idx ON system_events(level, component, symbol, timestamp DESC);

CREATE TABLE IF NOT EXISTS symbol_metadata (
  symbol TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  base_asset TEXT NOT NULL,
  quote_asset TEXT NOT NULL,
  margin_asset TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  price_precision INTEGER NOT NULL,
  quantity_precision INTEGER NOT NULL,
  tick_size TEXT,
  step_size TEXT,
  min_qty TEXT,
  max_qty TEXT,
  min_notional TEXT,
  filters_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
