CREATE TABLE agent_world.approvals (
  id text PRIMARY KEY CHECK (id ~ '^approval_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  task_id text NOT NULL UNIQUE REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'DENIED', 'REVOKED')),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > requested_at),
  decided_at timestamptz,
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
  decision_command_id text UNIQUE CHECK (
    decision_command_id IS NULL OR (
      char_length(decision_command_id) BETWEEN 1 AND 512
      AND decision_command_id !~ '[[:cntrl:]]'
    )
  ),
  UNIQUE (id, task_id),
  CHECK (
    (state = 'PENDING' AND decided_at IS NULL AND reason IS NULL AND decision_command_id IS NULL)
    OR (state = 'APPROVED' AND decided_at IS NOT NULL AND reason IS NULL AND decision_command_id IS NOT NULL)
    OR (state IN ('DENIED', 'REVOKED') AND decided_at IS NOT NULL AND reason IS NOT NULL AND decision_command_id IS NOT NULL)
  )
);

INSERT INTO agent_world.approvals (id, task_id, state, requested_at, expires_at)
SELECT 'approval_' || substring(id from char_length('task_') + 1),
       id,
       'PENDING',
       created_at,
       created_at + interval '24 hours'
  FROM agent_world.tasks;

CREATE TABLE agent_world.runs (
  id text PRIMARY KEY CHECK (id ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  task_id text NOT NULL UNIQUE,
  conversation_id text NOT NULL,
  agent_id text NOT NULL,
  approval_id text NOT NULL,
  adapter_kind text NOT NULL CHECK (adapter_kind = 'OPENCLAW'),
  binding_id text NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('DISPATCH_PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 10),
  dispatch_idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(dispatch_idempotency_key) BETWEEN 1 AND 512
    AND dispatch_idempotency_key !~ '[[:cntrl:]]'
  ),
  external_run_id text CHECK (
    external_run_id IS NULL OR (
      char_length(external_run_id) BETWEEN 1 AND 512
      AND external_run_id !~ '[[:cntrl:]]'
    )
  ),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  UNIQUE (id, task_id),
  FOREIGN KEY (task_id, agent_id) REFERENCES agent_world.tasks(id, assignee_agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_id, task_id) REFERENCES agent_world.approvals(id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_id, agent_id, adapter_kind)
    REFERENCES agent_world.runtime_bindings(id, agent_id, adapter_kind) ON DELETE RESTRICT,
  FOREIGN KEY (session_id, conversation_id, agent_id)
    REFERENCES agent_world.conversation_sessions(id, conversation_id, agent_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'DISPATCH_PENDING' AND attempt = 0 AND external_run_id IS NULL
      AND started_at IS NULL AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'RUNNING' AND attempt > 0 AND external_run_id IS NOT NULL
      AND started_at IS NOT NULL AND completed_at IS NULL AND failure_code IS NULL)
    OR (status = 'COMPLETED' AND attempt > 0 AND external_run_id IS NOT NULL
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'FAILED' AND attempt > 0 AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
    OR (status = 'CANCELLED' AND completed_at IS NOT NULL AND failure_code IS NULL)
  )
);

ALTER TABLE agent_world.world_events
  DROP CONSTRAINT world_events_source_shape_check,
  DROP CONSTRAINT world_events_event_type_check,
  ADD COLUMN source_actor text,
  ADD COLUMN run_id text,
  ADD COLUMN approval_id text,
  ADD COLUMN approval_state text,
  ADD COLUMN approval_requested_at timestamptz,
  ADD COLUMN approval_expires_at timestamptz,
  ADD COLUMN approval_decided_at timestamptz,
  ADD COLUMN approval_reason text,
  ADD CONSTRAINT world_events_event_type_check
    CHECK (event_type IN ('AGENT_STATUS_CHANGED', 'TASK_ASSIGNED', 'APPROVAL_STATE_CHANGED')),
  ADD CONSTRAINT world_events_source_actor_check CHECK (
    (source_kind = 'RUNTIME' AND source_actor IS NULL)
    OR (source_kind = 'DOMAIN' AND source_actor IN ('OWNER', 'SYSTEM_POLICY'))
  ) NOT VALID,
  ADD CONSTRAINT world_events_run_task_fkey
    FOREIGN KEY (run_id, task_id) REFERENCES agent_world.runs(id, task_id) ON DELETE RESTRICT,
  ADD CONSTRAINT world_events_approval_task_fkey
    FOREIGN KEY (approval_id, task_id) REFERENCES agent_world.approvals(id, task_id) ON DELETE RESTRICT;

UPDATE agent_world.world_events SET source_actor = 'OWNER' WHERE source_kind = 'DOMAIN';

ALTER TABLE agent_world.world_events VALIDATE CONSTRAINT world_events_source_actor_check;

ALTER TABLE agent_world.world_events
  ADD CONSTRAINT world_events_source_shape_check CHECK (
    (source_kind = 'RUNTIME' AND event_type = 'AGENT_STATUS_CHANGED'
      AND adapter_kind = 'OPENCLAW' AND binding_id IS NOT NULL
      AND external_event_id IS NOT NULL AND status IS NOT NULL
      AND source_actor IS NULL AND command_id IS NULL AND task_id IS NULL AND run_id IS NULL
      AND approval_id IS NULL AND approval_state IS NULL AND approval_requested_at IS NULL
      AND approval_expires_at IS NULL AND approval_decided_at IS NULL AND approval_reason IS NULL)
    OR
    (source_kind = 'DOMAIN' AND event_type = 'TASK_ASSIGNED'
      AND source_actor = 'OWNER' AND command_id IS NOT NULL AND task_id IS NOT NULL
      AND adapter_kind IS NULL AND binding_id IS NULL AND external_event_id IS NULL
      AND status IS NULL AND run_id IS NULL AND approval_id IS NULL AND approval_state IS NULL
      AND approval_requested_at IS NULL AND approval_expires_at IS NULL
      AND approval_decided_at IS NULL AND approval_reason IS NULL)
    OR
    (source_kind = 'DOMAIN' AND event_type = 'APPROVAL_STATE_CHANGED'
      AND source_actor = 'OWNER' AND command_id IS NOT NULL AND task_id IS NOT NULL
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

CREATE INDEX runs_dispatch_pending
  ON agent_world.runs (created_at, id) WHERE status = 'DISPATCH_PENDING';
