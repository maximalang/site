ALTER TABLE agent_world.tasks
  ADD CONSTRAINT tasks_id_mission_key UNIQUE (id, mission_id);

CREATE TABLE agent_world.mission_handoff_activations (
  task_id text PRIMARY KEY,
  mission_id text NOT NULL,
  approval_id text NOT NULL UNIQUE REFERENCES agent_world.approvals(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (task_id, mission_id)
    REFERENCES agent_world.tasks(id, mission_id) ON DELETE RESTRICT
);

CREATE TABLE agent_world.mission_handoffs (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE CHECK (sequence > 0),
  id text PRIMARY KEY CHECK (
    id ~ '^event_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  mission_id text NOT NULL REFERENCES agent_world.missions(id) ON DELETE RESTRICT,
  from_task_id text NOT NULL REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  to_task_id text NOT NULL,
  from_run_id text NOT NULL REFERENCES agent_world.runs(id) ON DELETE RESTRICT,
  approval_id text NOT NULL REFERENCES agent_world.approvals(id) ON DELETE RESTRICT,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (to_task_id, mission_id)
    REFERENCES agent_world.tasks(id, mission_id) ON DELETE RESTRICT,
  UNIQUE (mission_id, from_task_id, to_task_id),
  CHECK (from_task_id <> to_task_id)
);

CREATE INDEX mission_handoffs_replay
  ON agent_world.mission_handoffs (mission_id, sequence, id);
