ALTER TABLE agent_world.mission_decompositions
  ADD COLUMN materialized_at timestamptz,
  ADD CONSTRAINT mission_decompositions_materialized_time_check CHECK (
    materialized_at IS NULL OR materialized_at >= created_at
  );

ALTER TABLE agent_world.mission_decomposition_tasks
  ADD COLUMN task_id text;

UPDATE agent_world.mission_decomposition_tasks
   SET task_id = 'task_' || substring(md5(decomposition_id || ':' || task_key) from 1 for 8) || '-' ||
                 substring(md5(decomposition_id || ':' || task_key) from 9 for 4) || '-' ||
                 substring(md5(decomposition_id || ':' || task_key) from 13 for 4) || '-' ||
                 substring(md5(decomposition_id || ':' || task_key) from 17 for 4) || '-' ||
                 substring(md5(decomposition_id || ':' || task_key) from 21 for 12);

ALTER TABLE agent_world.mission_decomposition_tasks
  ALTER COLUMN task_id SET NOT NULL,
  ADD CONSTRAINT mission_decomposition_tasks_task_id_check CHECK (
    task_id ~ '^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  ADD CONSTRAINT mission_decomposition_tasks_task_id_key UNIQUE (task_id),
  ADD CONSTRAINT mission_decomposition_tasks_identity_key
    UNIQUE (decomposition_id, task_key, task_id);

CREATE TABLE agent_world.mission_decomposition_dependencies (
  decomposition_id text NOT NULL,
  task_key text NOT NULL,
  depends_on_task_key text NOT NULL,
  PRIMARY KEY (decomposition_id, task_key, depends_on_task_key),
  FOREIGN KEY (decomposition_id, task_key)
    REFERENCES agent_world.mission_decomposition_tasks(decomposition_id, task_key)
    ON DELETE CASCADE,
  FOREIGN KEY (decomposition_id, depends_on_task_key)
    REFERENCES agent_world.mission_decomposition_tasks(decomposition_id, task_key)
    ON DELETE CASCADE,
  CHECK (task_key <> depends_on_task_key)
);

ALTER TABLE agent_world.tasks ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE agent_world.runs ALTER COLUMN conversation_id DROP NOT NULL;

CREATE TABLE agent_world.mission_task_dependencies (
  mission_id text NOT NULL REFERENCES agent_world.missions(id) ON DELETE RESTRICT,
  task_id text NOT NULL REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  depends_on_task_id text NOT NULL REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  PRIMARY KEY (mission_id, task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX mission_tasks_replay_idx
  ON agent_world.tasks (mission_id, created_at, id)
  WHERE mission_id IS NOT NULL;

ALTER TABLE agent_world.world_events
  DROP CONSTRAINT world_events_source_shape_check,
  ADD CONSTRAINT world_events_source_shape_check CHECK (
    (source_kind = 'RUNTIME' AND event_type = 'AGENT_STATUS_CHANGED'
      AND adapter_kind = 'OPENCLAW' AND binding_id IS NOT NULL
      AND external_event_id IS NOT NULL AND status IS NOT NULL
      AND source_actor IS NULL AND command_id IS NULL AND task_id IS NULL AND run_id IS NULL
      AND approval_id IS NULL AND approval_state IS NULL AND approval_requested_at IS NULL
      AND approval_expires_at IS NULL AND approval_decided_at IS NULL AND approval_reason IS NULL)
    OR
    (source_kind = 'DOMAIN' AND event_type = 'TASK_ASSIGNED'
      AND source_actor IN ('OWNER', 'SYSTEM_POLICY')
      AND command_id IS NOT NULL AND task_id IS NOT NULL
      AND adapter_kind IS NULL AND binding_id IS NULL AND external_event_id IS NULL
      AND status IS NULL AND run_id IS NULL AND approval_id IS NULL AND approval_state IS NULL
      AND approval_requested_at IS NULL AND approval_expires_at IS NULL
      AND approval_decided_at IS NULL AND approval_reason IS NULL)
    OR
    (source_kind = 'DOMAIN' AND event_type = 'APPROVAL_STATE_CHANGED'
      AND source_actor IN ('OWNER', 'SYSTEM_POLICY')
      AND command_id IS NOT NULL AND task_id IS NOT NULL
      AND approval_id IS NOT NULL AND approval_state IN ('PENDING', 'APPROVED', 'DENIED', 'REVOKED')
      AND adapter_kind IS NULL AND binding_id IS NULL AND external_event_id IS NULL
      AND status IS NULL AND run_id IS NULL
      AND ((approval_state = 'PENDING' AND approval_requested_at IS NOT NULL
        AND approval_expires_at > approval_requested_at AND approval_decided_at IS NULL
        AND approval_reason IS NULL)
       OR (approval_state = 'APPROVED' AND approval_requested_at IS NULL
        AND approval_expires_at IS NULL AND approval_decided_at IS NOT NULL
        AND approval_reason IS NULL)
       OR (approval_state IN ('DENIED', 'REVOKED') AND approval_requested_at IS NULL
        AND approval_expires_at IS NULL AND approval_decided_at IS NOT NULL
        AND approval_reason IS NOT NULL)))
    OR
    (source_kind = 'DOMAIN' AND event_type = 'AGENT_STATUS_CHANGED'
      AND source_actor = 'SYSTEM_POLICY' AND command_id IS NOT NULL AND status IS NOT NULL
      AND adapter_kind IS NULL AND binding_id IS NULL AND external_event_id IS NULL
      AND approval_id IS NULL AND approval_state IS NULL AND approval_requested_at IS NULL
      AND approval_expires_at IS NULL AND approval_decided_at IS NULL AND approval_reason IS NULL)
  );
