CREATE TABLE IF NOT EXISTS research_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  symbol TEXT NOT NULL,
  directions TEXT NOT NULL CHECK(directions IN ('LONG','SHORT','LONG_AND_SHORT')),
  trigger_timeframe TEXT NOT NULL,
  execution_timeframe TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','QUEUED','INITIALIZING','RUNNING','PAUSING','PAUSED','RESUMING','COMPLETED','CANCELLING','CANCELLED','FAILED')),
  health TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(health IN ('HEALTHY','DEGRADED','UNHEALTHY','UNKNOWN')),
  stage TEXT NOT NULL DEFAULT 'DRAFT',
  progress REAL NOT NULL DEFAULT 0,
  candidate_budget INTEGER NOT NULL,
  generated_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  structurally_rejected_count INTEGER NOT NULL DEFAULT 0,
  is_tested_count INTEGER NOT NULL DEFAULT 0,
  is_survivor_count INTEGER NOT NULL DEFAULT 0,
  oos_tested_count INTEGER NOT NULL DEFAULT 0,
  oos_survivor_count INTEGER NOT NULL DEFAULT 0,
  finalist_count INTEGER NOT NULL DEFAULT 0,
  holdout_tested_count INTEGER NOT NULL DEFAULT 0,
  promoted_count INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  periods_json TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  dataset_fingerprint_json TEXT NOT NULL DEFAULT '{}',
  engine_version TEXT NOT NULL,
  indicator_registry_version TEXT NOT NULL,
  search_algorithm_version TEXT NOT NULL,
  splitter_version TEXT NOT NULL,
  random_seed INTEGER NOT NULL,
  holdout_evaluated INTEGER NOT NULL DEFAULT 0,
  holdout_exposed INTEGER NOT NULL DEFAULT 0,
  holdout_exposed_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS research_runs_status_created_idx ON research_runs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS research_candidates (
  id TEXT PRIMARY KEY,
  research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  generation_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('GENERATED','STRUCTURAL_REJECTED','IS_REJECTED','OOS_REJECTED','FINALIST','HOLDOUT_REJECTED','COMPLETED','PROMOTED','PINNED','REJECTED')),
  family TEXT NOT NULL,
  direction TEXT NOT NULL,
  raw_ast_json TEXT NOT NULL,
  normalized_ast_json TEXT NOT NULL,
  normalized_hash TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  complexity_score INTEGER NOT NULL,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  score REAL,
  pareto_rank INTEGER,
  rejection_stage TEXT,
  rejection_reason TEXT,
  promoted_strategy_id TEXT REFERENCES strategies(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(research_run_id, normalized_hash)
);
CREATE INDEX IF NOT EXISTS research_candidates_run_status_score_idx ON research_candidates(research_run_id, status, score DESC);
CREATE INDEX IF NOT EXISTS research_candidates_hash_idx ON research_candidates(normalized_hash);

CREATE TABLE IF NOT EXISTS research_events (
  id TEXT PRIMARY KEY,
  research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  stage TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS research_events_run_timestamp_idx ON research_events(research_run_id, timestamp);

CREATE TABLE IF NOT EXISTS research_candidate_promotions (
  id TEXT PRIMARY KEY,
  research_candidate_id TEXT NOT NULL UNIQUE REFERENCES research_candidates(id),
  research_run_id TEXT NOT NULL REFERENCES research_runs(id),
  strategy_id TEXT NOT NULL UNIQUE REFERENCES strategies(id),
  strategy_version_id TEXT NOT NULL UNIQUE REFERENCES strategy_versions(id),
  verification_run_id TEXT REFERENCES verification_runs(id),
  actor TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
