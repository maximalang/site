ALTER TABLE agent_world.runs
  ADD CONSTRAINT runs_native_chat_provenance_key
  UNIQUE (id, task_id, agent_id, adapter_kind);

CREATE TABLE agent_world.native_chat_dispatches (
  id text PRIMARY KEY CHECK (
    id ~ '^chat_dispatch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  run_id text NOT NULL UNIQUE,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  route_id text NOT NULL,
  adapter_kind text NOT NULL DEFAULT 'NATIVE_CHATGPT' CHECK (adapter_kind = 'NATIVE_CHATGPT'),
  mode text NOT NULL DEFAULT 'CHAT' CHECK (mode = 'CHAT'),
  state text NOT NULL CHECK (state IN ('QUEUED', 'BROWSER_SUBMITTED', 'ATTACHED', 'FAILED')),
  last_sequence integer NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  created_at timestamptz NOT NULL,
  submitted_at timestamptz,
  attached_at timestamptz,
  failed_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  FOREIGN KEY (run_id, task_id, agent_id, adapter_kind)
    REFERENCES agent_world.runs(id, task_id, agent_id, adapter_kind) ON DELETE RESTRICT,
  FOREIGN KEY (route_id, account_id, adapter_kind, mode)
    REFERENCES agent_world.execution_routes(id, account_id, adapter_kind, mode) ON DELETE RESTRICT,
  CHECK (
    (state = 'QUEUED' AND submitted_at IS NULL AND attached_at IS NULL
      AND failed_at IS NULL AND failure_code IS NULL AND last_sequence = 0)
    OR (state = 'BROWSER_SUBMITTED' AND submitted_at IS NOT NULL AND attached_at IS NULL
      AND failed_at IS NULL AND failure_code IS NULL AND last_sequence = 0)
    OR (state = 'ATTACHED' AND submitted_at IS NOT NULL AND attached_at IS NOT NULL
      AND failed_at IS NULL AND failure_code IS NULL AND last_sequence > 0)
    OR (state = 'FAILED' AND failed_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE TABLE agent_world.native_chat_control_events (
  run_id text NOT NULL REFERENCES agent_world.native_chat_dispatches(run_id) ON DELETE RESTRICT,
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence > 0),
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 512
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  event_type text NOT NULL CHECK (event_type IN (
    'BEGIN_RUN', 'HEARTBEAT', 'FINDING', 'ARTIFACT', 'DECISION', 'HANDOFF',
    'FAIL', 'COMMIT_RESULT'
  )),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  event_sha256 text NOT NULL CHECK (event_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, sequence),
  UNIQUE (run_id, event_sha256)
);

CREATE TABLE agent_world.native_chat_results (
  run_id text PRIMARY KEY REFERENCES agent_world.native_chat_dispatches(run_id) ON DELETE RESTRICT,
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  event_sequence integer NOT NULL CHECK (event_sequence > 0),
  structured_result jsonb NOT NULL CHECK (jsonb_typeof(structured_result) = 'object'),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz NOT NULL,
  FOREIGN KEY (run_id, event_sequence)
    REFERENCES agent_world.native_chat_control_events(run_id, sequence) ON DELETE RESTRICT
);

CREATE INDEX native_chat_dispatches_active
  ON agent_world.native_chat_dispatches (created_at, id)
  WHERE state IN ('QUEUED', 'BROWSER_SUBMITTED', 'ATTACHED');

CREATE INDEX native_chat_control_events_timeline
  ON agent_world.native_chat_control_events (occurred_at, run_id, sequence);
