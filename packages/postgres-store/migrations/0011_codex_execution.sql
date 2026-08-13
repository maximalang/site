ALTER TABLE agent_world.runs
  DROP CONSTRAINT runs_adapter_kind_check,
  ADD CONSTRAINT runs_adapter_kind_check CHECK (adapter_kind IN (
    'OPENCLAW', 'CODEX', 'API_MODEL', 'LOCAL_MODEL', 'NATIVE_CHATGPT', 'NATIVE_WORK'
  )),
  ADD CONSTRAINT runs_execution_provenance_key
    UNIQUE (id, task_id, agent_id, binding_id, session_id, adapter_kind);

ALTER TABLE agent_world.runtime_bindings
  ADD CONSTRAINT runtime_bindings_execution_provenance_key
    UNIQUE (id, route_id, agent_id, adapter_kind);

ALTER TABLE agent_world.execution_routes
  ADD CONSTRAINT execution_routes_account_provenance_key
    UNIQUE NULLS NOT DISTINCT (id, account_id, adapter_kind, mode);

CREATE TABLE agent_world.codex_execution_jobs (
  id text PRIMARY KEY CHECK (
    id ~ '^codex_execution_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  run_id text NOT NULL UNIQUE,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  binding_id text NOT NULL,
  route_id text NOT NULL,
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  session_id text NOT NULL,
  adapter_kind text NOT NULL DEFAULT 'CODEX' CHECK (adapter_kind = 'CODEX'),
  mode text NOT NULL DEFAULT 'CODEX' CHECK (mode = 'CODEX'),
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 512
    AND idempotency_key !~ '[[:cntrl:]]'
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  codex_thread_id text NOT NULL CHECK (
    char_length(codex_thread_id) BETWEEN 1 AND 512
    AND codex_thread_id !~ '[[:cntrl:]]'
  ),
  prompt text NOT NULL CHECK (
    char_length(prompt) BETWEEN 1 AND 50000
    AND char_length(btrim(prompt)) > 0
  ),
  working_directory text NOT NULL CHECK (
    char_length(working_directory) BETWEEN 1 AND 4096
    AND working_directory !~ '[[:cntrl:]]'
  ),
  sandbox text NOT NULL CHECK (sandbox IN ('READ_ONLY', 'WORKSPACE_WRITE')),
  approval_policy text NOT NULL CHECK (approval_policy IN ('NEVER', 'ON_REQUEST', 'UNTRUSTED')),
  network_access boolean NOT NULL,
  timeout_ms integer NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 14400000),
  model text CHECK (
    model IS NULL OR (
      char_length(btrim(model)) BETWEEN 1 AND 200
      AND model !~ '[[:cntrl:]]'
    )
  ),
  reasoning_effort text CHECK (
    reasoning_effort IS NULL OR reasoning_effort IN ('MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH')
  ),
  status text NOT NULL CHECK (
    status IN ('QUEUED', 'LEASED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  lease_owner text CHECK (
    lease_owner IS NULL OR (
      char_length(lease_owner) BETWEEN 1 AND 128
      AND lease_owner !~ '[[:cntrl:]]'
    )
  ),
  lease_expires_at timestamptz,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 10),
  accepted_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  final_output text CHECK (
    final_output IS NULL OR char_length(final_output) BETWEEN 1 AND 200000
  ),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens bigint CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (run_id, task_id, agent_id, binding_id, session_id, adapter_kind)
    REFERENCES agent_world.runs(id, task_id, agent_id, binding_id, session_id, adapter_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (binding_id, route_id, agent_id, adapter_kind)
    REFERENCES agent_world.runtime_bindings(id, route_id, agent_id, adapter_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (route_id, account_id, adapter_kind, mode)
    REFERENCES agent_world.execution_routes(id, account_id, adapter_kind, mode)
    ON DELETE RESTRICT,
  CHECK (
    (input_tokens IS NULL AND cached_input_tokens IS NULL AND output_tokens IS NULL)
    OR
    (input_tokens IS NOT NULL AND cached_input_tokens BETWEEN 0 AND input_tokens
      AND output_tokens IS NOT NULL)
  ),
  CHECK (
    (status = 'QUEUED' AND attempt = 0 AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND started_at IS NULL AND completed_at IS NULL AND failure_code IS NULL
      AND final_output IS NULL AND input_tokens IS NULL)
    OR
    (status = 'LEASED' AND attempt > 0 AND lease_owner IS NOT NULL
      AND lease_expires_at > updated_at AND started_at IS NULL AND completed_at IS NULL
      AND failure_code IS NULL AND final_output IS NULL AND input_tokens IS NULL)
    OR
    (status = 'RUNNING' AND attempt > 0 AND lease_owner IS NOT NULL
      AND lease_expires_at > updated_at AND started_at IS NOT NULL AND completed_at IS NULL
      AND failure_code IS NULL)
    OR
    (status = 'COMPLETED' AND attempt > 0 AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND started_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL
      AND final_output IS NOT NULL AND input_tokens IS NOT NULL)
    OR
    (status = 'FAILED' AND attempt > 0 AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL AND failure_code IS NOT NULL)
    OR
    (status = 'CANCELLED' AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND completed_at IS NOT NULL AND failure_code IS NULL)
  )
);

CREATE TABLE agent_world.codex_execution_events (
  execution_id text NOT NULL REFERENCES agent_world.codex_execution_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'RUN_STARTED', 'ITEM_COMPLETED', 'FINAL_OUTPUT', 'USAGE_RECORDED',
    'RUN_COMPLETED', 'RUN_FAILED'
  )),
  occurred_at timestamptz NOT NULL,
  event_sha256 text NOT NULL CHECK (event_sha256 ~ '^[a-f0-9]{64}$'),
  thread_id text CHECK (
    thread_id IS NULL OR (
      char_length(thread_id) BETWEEN 1 AND 512
      AND thread_id !~ '[[:cntrl:]]'
    )
  ),
  upstream_turn_id text CHECK (
    upstream_turn_id IS NULL OR (
      char_length(upstream_turn_id) BETWEEN 1 AND 512
      AND upstream_turn_id !~ '[[:cntrl:]]'
    )
  ),
  item_id text CHECK (
    item_id IS NULL OR (
      char_length(item_id) BETWEEN 1 AND 512
      AND item_id !~ '[[:cntrl:]]'
    )
  ),
  item_type text CHECK (
    item_type IS NULL OR item_type IN (
      'MESSAGE', 'COMMAND', 'FILE_CHANGE', 'MCP_CALL', 'WEB_SEARCH',
      'REASONING', 'TODO', 'ERROR'
    )
  ),
  content text CHECK (content IS NULL OR char_length(content) BETWEEN 1 AND 200000),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens bigint CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  PRIMARY KEY (execution_id, sequence),
  CHECK (
    (event_type = 'RUN_STARTED' AND thread_id IS NOT NULL AND item_id IS NULL
      AND content IS NULL AND input_tokens IS NULL AND failure_code IS NULL)
    OR
    (event_type = 'ITEM_COMPLETED' AND item_id IS NOT NULL AND item_type IS NOT NULL
      AND thread_id IS NULL AND upstream_turn_id IS NULL AND content IS NULL
      AND input_tokens IS NULL AND failure_code IS NULL)
    OR
    (event_type = 'FINAL_OUTPUT' AND content IS NOT NULL AND thread_id IS NULL
      AND upstream_turn_id IS NULL AND item_id IS NULL AND input_tokens IS NULL
      AND failure_code IS NULL)
    OR
    (event_type = 'USAGE_RECORDED' AND input_tokens IS NOT NULL
      AND cached_input_tokens BETWEEN 0 AND input_tokens AND output_tokens IS NOT NULL
      AND thread_id IS NULL AND upstream_turn_id IS NULL AND item_id IS NULL
      AND content IS NULL AND failure_code IS NULL)
    OR
    (event_type = 'RUN_COMPLETED' AND thread_id IS NULL AND upstream_turn_id IS NULL
      AND item_id IS NULL AND content IS NULL AND input_tokens IS NULL AND failure_code IS NULL)
    OR
    (event_type = 'RUN_FAILED' AND failure_code IS NOT NULL AND thread_id IS NULL
      AND upstream_turn_id IS NULL AND item_id IS NULL AND content IS NULL
      AND input_tokens IS NULL)
  )
);

CREATE UNIQUE INDEX codex_execution_events_singletons
  ON agent_world.codex_execution_events (execution_id, event_type)
  WHERE event_type IN (
    'RUN_STARTED', 'FINAL_OUTPUT', 'USAGE_RECORDED', 'RUN_COMPLETED', 'RUN_FAILED'
  );

CREATE UNIQUE INDEX codex_execution_events_items
  ON agent_world.codex_execution_events (execution_id, item_id)
  WHERE event_type = 'ITEM_COMPLETED';

CREATE INDEX codex_execution_jobs_queue
  ON agent_world.codex_execution_jobs (accepted_at, id)
  WHERE status = 'QUEUED';

CREATE INDEX codex_execution_jobs_expired_leases
  ON agent_world.codex_execution_jobs (lease_expires_at, id)
  WHERE status IN ('LEASED', 'RUNNING');
