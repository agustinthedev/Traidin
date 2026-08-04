-- Durable generation funnel, structural diagnostics, and warmup provenance.
ALTER TABLE research_runs ADD COLUMN generation_error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN accepted_valid_unique_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN queued_for_is_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN evaluated_in_is_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN rejected_in_is_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN advanced_to_oos_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN rejected_in_oos_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN advanced_to_holdout_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN rejected_in_holdout_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN evaluation_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN cancelled_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN terminal_persisted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN exported_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE research_runs ADD COLUMN reconciliation_mismatch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN reconciliation_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_runs ADD COLUMN template_counts_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_runs ADD COLUMN predicate_role_counts_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_runs ADD COLUMN shared_filter_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN multi_condition_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN cross_family_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN warmup_policy_version TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE research_candidates ADD COLUMN template_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_candidates ADD COLUMN template_versions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_candidates ADD COLUMN predicate_metadata_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_candidates ADD COLUMN structural_validation TEXT;
ALTER TABLE research_candidates ADD COLUMN structural_actions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_candidates ADD COLUMN simplified_normalized_hash TEXT;
ALTER TABLE research_candidates ADD COLUMN simplified_normalized_ast_json TEXT;

CREATE TABLE IF NOT EXISTS research_generation_attempts (
  id TEXT PRIMARY KEY,
  research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  attempt_index INTEGER NOT NULL,
  deterministic_seed INTEGER,
  rng_position_json TEXT NOT NULL DEFAULT '{}',
  generator_version TEXT NOT NULL,
  grammar_version TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  selected_indicators_json TEXT NOT NULL DEFAULT '[]',
  selected_outputs_json TEXT NOT NULL DEFAULT '[]',
  selected_template_ids_json TEXT NOT NULL DEFAULT '[]',
  proposed_parameters_json TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL CHECK(result IN ('GENERATION_ERROR','GENERATED','STATIC_REJECTED','PREFLIGHT_REJECTED','EXACT_DUPLICATE','SEMANTIC_DUPLICATE','ACCEPTED_FOR_EVALUATION')),
  rejection_code TEXT,
  rejection_message TEXT,
  candidate_id TEXT REFERENCES research_candidates(id),
  duplicate_of_candidate_id TEXT REFERENCES research_candidates(id),
  duration_ms INTEGER,
  diagnostic_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS research_generation_attempts_run_index_idx ON research_generation_attempts(research_run_id, attempt_index);
CREATE INDEX IF NOT EXISTS research_generation_attempts_run_result_idx ON research_generation_attempts(research_run_id, result);
