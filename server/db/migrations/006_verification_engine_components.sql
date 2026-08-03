ALTER TABLE verification_runs ADD COLUMN walk_forward_engine_version TEXT;
ALTER TABLE verification_runs ADD COLUMN robustness_engine_version TEXT;
ALTER TABLE verification_runs ADD COLUMN stress_engine_version TEXT;
ALTER TABLE verification_runs ADD COLUMN report_engine_version TEXT;
