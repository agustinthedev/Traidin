ALTER TABLE verification_runs ADD COLUMN monte_carlo_engine_version TEXT;
ALTER TABLE verification_runs ADD COLUMN export_version TEXT;
ALTER TABLE verification_runs ADD COLUMN audit_status TEXT;
ALTER TABLE verification_runs ADD COLUMN audit_updated_at INTEGER;

CREATE INDEX IF NOT EXISTS verification_runs_audit_status_idx ON verification_runs(audit_status, completed_at DESC);
