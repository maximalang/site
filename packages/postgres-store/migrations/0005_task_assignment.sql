ALTER TABLE agent_world.conversations
  ADD CONSTRAINT conversations_task_scope_key UNIQUE (id, project_id, agent_id);

CREATE TABLE agent_world.tasks (
  id text PRIMARY KEY CHECK (id ~ '^task_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  conversation_id text NOT NULL,
  project_id text NOT NULL,
  assignee_agent_id text NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(btrim(description)) BETWEEN 1 AND 20000),
  approval_requirement text NOT NULL CHECK (approval_requirement = 'REQUIRED'),
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 512
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (conversation_id, project_id, assignee_agent_id)
    REFERENCES agent_world.conversations(id, project_id, agent_id)
    ON DELETE RESTRICT,
  UNIQUE (id, assignee_agent_id)
);

ALTER TABLE agent_world.world_events
  DROP CONSTRAINT world_events_source_kind_check,
  DROP CONSTRAINT world_events_event_type_check,
  ALTER COLUMN adapter_kind DROP NOT NULL,
  ALTER COLUMN binding_id DROP NOT NULL,
  ALTER COLUMN external_event_id DROP NOT NULL,
  ALTER COLUMN status DROP NOT NULL,
  ADD COLUMN command_id text CHECK (
    command_id IS NULL OR (
      char_length(command_id) BETWEEN 1 AND 512
      AND command_id !~ '[[:cntrl:]]'
    )
  ),
  ADD COLUMN task_id text,
  ADD CONSTRAINT world_events_source_kind_check
    CHECK (source_kind IN ('RUNTIME', 'DOMAIN')),
  ADD CONSTRAINT world_events_event_type_check
    CHECK (event_type IN ('AGENT_STATUS_CHANGED', 'TASK_ASSIGNED')),
  ADD CONSTRAINT world_events_task_assignee_fkey
    FOREIGN KEY (task_id, agent_id)
    REFERENCES agent_world.tasks(id, assignee_agent_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT world_events_source_shape_check CHECK (
    (source_kind = 'RUNTIME'
      AND event_type = 'AGENT_STATUS_CHANGED'
      AND adapter_kind = 'OPENCLAW'
      AND binding_id IS NOT NULL
      AND external_event_id IS NOT NULL
      AND status IS NOT NULL
      AND command_id IS NULL
      AND task_id IS NULL)
    OR
    (source_kind = 'DOMAIN'
      AND event_type = 'TASK_ASSIGNED'
      AND adapter_kind IS NULL
      AND binding_id IS NULL
      AND external_event_id IS NULL
      AND status IS NULL
      AND command_id IS NOT NULL
      AND task_id IS NOT NULL)
  );
