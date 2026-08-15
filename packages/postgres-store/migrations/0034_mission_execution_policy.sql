ALTER TABLE agent_world.missions
  ADD COLUMN execution_policy text NOT NULL DEFAULT 'REVIEW_EACH_TASK'
  CHECK (execution_policy IN ('REVIEW_EACH_TASK', 'AUTO_SAFE_HANDOFF'));

CREATE INDEX mission_auto_handoff_candidates_idx
  ON agent_world.missions (id)
  WHERE status = 'ACTIVE' AND execution_policy = 'AUTO_SAFE_HANDOFF';
