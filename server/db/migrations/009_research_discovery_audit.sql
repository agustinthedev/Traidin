-- Discovery accounting and provenance fields. All additions are nullable/defaulted
-- so existing Strategy Lab runs remain readable without reinterpretation.
ALTER TABLE research_runs ADD COLUMN generation_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN generated_raw_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN static_rejected_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN preflight_rejected_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN exact_duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN semantic_duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN accepted_candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN evaluated_candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN unevaluated_candidate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN generation_exhausted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE research_runs ADD COLUMN generation_exhaustion_reason TEXT;
ALTER TABLE research_runs ADD COLUMN completion_reason TEXT;
ALTER TABLE research_runs ADD COLUMN grammar_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE research_runs ADD COLUMN generation_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_runs ADD COLUMN validation_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_runs ADD COLUMN deduplication_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_runs ADD COLUMN cost_model_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE research_candidates ADD COLUMN semantic_fingerprint TEXT;
ALTER TABLE research_candidates ADD COLUMN generation_attempt_index INTEGER;
ALTER TABLE research_candidates ADD COLUMN duplicate_of_candidate_id TEXT REFERENCES research_candidates(id);
ALTER TABLE research_candidates ADD COLUMN validation_status TEXT;
ALTER TABLE research_candidates ADD COLUMN validation_errors_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE research_candidates ADD COLUMN preflight_metrics_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_candidates ADD COLUMN terminal_reason TEXT;
ALTER TABLE research_candidates ADD COLUMN stage_rejection_reasons_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_candidates ADD COLUMN complexity_breakdown_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE research_candidates ADD COLUMN human_description TEXT;
ALTER TABLE research_candidates ADD COLUMN generator_version TEXT;
ALTER TABLE research_candidates ADD COLUMN grammar_version TEXT;
ALTER TABLE research_candidates ADD COLUMN registry_version TEXT;

CREATE INDEX IF NOT EXISTS research_candidates_semantic_fingerprint_idx ON research_candidates(research_run_id, semantic_fingerprint);
