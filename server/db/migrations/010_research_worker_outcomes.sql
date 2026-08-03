-- Explicit Research Run outcomes and durable worker ownership. Legacy rows keep
-- LEGACY until a new execution updates them; no old candidate is reinterpreted.
ALTER TABLE research_runs ADD COLUMN terminal_outcome TEXT NOT NULL DEFAULT 'LEGACY' CHECK(terminal_outcome IN ('PENDING','COMPLETED','PARTIAL','EXHAUSTED','FAILED','CANCELLED','LEGACY'));
ALTER TABLE research_runs ADD COLUMN completion_message TEXT;
ALTER TABLE research_runs ADD COLUMN max_generation_attempts INTEGER;
ALTER TABLE research_runs ADD COLUMN worker_id TEXT;
ALTER TABLE research_runs ADD COLUMN claim_token TEXT;
ALTER TABLE research_runs ADD COLUMN claimed_at INTEGER;
ALTER TABLE research_runs ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE research_runs ADD COLUMN heartbeat_at INTEGER;
ALTER TABLE research_runs ADD COLUMN last_progress_at INTEGER;
ALTER TABLE research_runs ADD COLUMN worker_failure_code TEXT;
ALTER TABLE research_runs ADD COLUMN worker_failure_message TEXT;
ALTER TABLE research_candidates ADD COLUMN formatter_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE research_candidates ADD COLUMN preflight_diagnostics_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS research_runs_lease_idx ON research_runs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS research_runs_worker_idx ON research_runs(worker_id, status);
