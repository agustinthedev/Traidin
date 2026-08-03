CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ARCHIVED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_versions (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  parent_version_id TEXT REFERENCES strategy_versions(id),
  change_notes TEXT NOT NULL DEFAULT '',
  configuration_json TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  indicator_registry_version TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(verification_status IN ('DRAFT','READY_FOR_VERIFICATION','VERIFIED','VERIFICATION_WARNING','VERIFICATION_FAILED','ARCHIVED')),
  created_at INTEGER NOT NULL,
  UNIQUE(strategy_id, version_number),
  UNIQUE(strategy_id, configuration_hash)
);
CREATE INDEX IF NOT EXISTS strategy_versions_strategy_created_idx ON strategy_versions(strategy_id, version_number DESC);

CREATE TABLE IF NOT EXISTS verification_runs (
  id TEXT PRIMARY KEY,
  strategy_version_id TEXT NOT NULL REFERENCES strategy_versions(id),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'BINANCE_USDM_FUTURES',
  requested_start INTEGER NOT NULL,
  requested_end INTEGER NOT NULL,
  actual_start INTEGER,
  actual_end INTEGER,
  status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','CANCELLING','CANCELLED','COMPLETED','FAILED')),
  stage TEXT NOT NULL DEFAULT 'QUEUED',
  progress REAL NOT NULL DEFAULT 0,
  stage_progress REAL NOT NULL DEFAULT 0,
  candles_processed INTEGER NOT NULL DEFAULT 0,
  events_processed INTEGER NOT NULL DEFAULT 0,
  trades_simulated INTEGER NOT NULL DEFAULT 0,
  estimated_work INTEGER NOT NULL DEFAULT 0,
  completed_work INTEGER NOT NULL DEFAULT 0,
  profile TEXT NOT NULL DEFAULT 'STANDARD',
  options_json TEXT NOT NULL,
  data_fingerprint_json TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  metrics_version TEXT NOT NULL,
  random_seed INTEGER NOT NULL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_runs_status_created_idx ON verification_runs(status, created_at);
CREATE INDEX IF NOT EXISTS verification_runs_version_idx ON verification_runs(strategy_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS verification_trades (
  id TEXT PRIMARY KEY,
  verification_run_id TEXT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('LONG','SHORT')),
  entry_time INTEGER NOT NULL,
  exit_time INTEGER NOT NULL,
  entry_price TEXT NOT NULL,
  exit_price TEXT NOT NULL,
  quantity TEXT NOT NULL,
  gross_pnl TEXT NOT NULL,
  net_pnl TEXT NOT NULL,
  fees TEXT NOT NULL,
  return_pct REAL NOT NULL,
  r_multiple REAL,
  mae_pct REAL,
  mfe_pct REAL,
  holding_ms INTEGER NOT NULL,
  entry_reason TEXT NOT NULL,
  exit_reason TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(verification_run_id, sequence)
);
CREATE INDEX IF NOT EXISTS verification_trades_run_entry_idx ON verification_trades(verification_run_id, entry_time);

CREATE TABLE IF NOT EXISTS verification_results (
  verification_run_id TEXT PRIMARY KEY REFERENCES verification_runs(id) ON DELETE CASCADE,
  metrics_json TEXT NOT NULL,
  equity_curve_json TEXT NOT NULL,
  breakdowns_json TEXT NOT NULL,
  scorecard_json TEXT NOT NULL,
  funnel_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_logs (
  id TEXT PRIMARY KEY,
  verification_run_id TEXT NOT NULL REFERENCES verification_runs(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  stage TEXT,
  symbol TEXT,
  timeframe TEXT,
  event_type TEXT NOT NULL,
  duration_ms INTEGER,
  message TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS verification_logs_run_timestamp_idx ON verification_logs(verification_run_id, timestamp);
