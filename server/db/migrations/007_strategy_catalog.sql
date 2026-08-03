-- Strategy identity is intentionally separate from immutable Strategy Versions.
-- Existing rows are preserved as manually-created strategies.
ALTER TABLE strategies ADD COLUMN origin TEXT NOT NULL DEFAULT 'MANUAL' CHECK(origin IN ('MANUAL','STRATEGY_LAB'));
ALTER TABLE strategies ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'DRAFT' CHECK(lifecycle IN ('DRAFT','READY_FOR_DEEP_VERIFICATION','VERIFIED','RETIRED'));
ALTER TABLE strategies ADD COLUMN cloned_from_strategy_id TEXT REFERENCES strategies(id);
ALTER TABLE strategies ADD COLUMN source_research_run_id TEXT;
ALTER TABLE strategies ADD COLUMN source_candidate_id TEXT;
ALTER TABLE strategies ADD COLUMN source_normalized_hash TEXT;

UPDATE strategies
SET lifecycle = CASE WHEN status = 'ARCHIVED' THEN 'RETIRED' ELSE 'DRAFT' END
WHERE lifecycle = 'DRAFT';

CREATE INDEX IF NOT EXISTS strategies_origin_lifecycle_updated_idx
  ON strategies(origin, lifecycle, updated_at DESC);
CREATE INDEX IF NOT EXISTS strategies_source_research_run_idx
  ON strategies(source_research_run_id);

CREATE TABLE IF NOT EXISTS strategy_events (
  id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT,
  created_at INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS strategy_events_strategy_created_idx
  ON strategy_events(strategy_id, created_at DESC);
