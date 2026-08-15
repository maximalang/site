CREATE TABLE agent_world.model_execution_jobs (
  id text PRIMARY KEY CHECK (
    id ~ '^model_execution_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  run_id text NOT NULL UNIQUE,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  binding_id text NOT NULL,
  session_id text NOT NULL,
  route_id text NOT NULL,
  model_route_id text NOT NULL REFERENCES agent_world.model_routes(id) ON DELETE RESTRICT,
  adapter_kind text NOT NULL CHECK (adapter_kind IN ('API_MODEL', 'LOCAL_MODEL')),
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 512 AND idempotency_key !~ '[[:cntrl:]]'
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('EXECUTING', 'COMPLETED', 'FAILED')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens bigint CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_usd numeric(20, 10) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_source text CHECK (cost_source IS NULL OR cost_source = 'LITELLM_RESPONSE_HEADER'),
  cost_estimated boolean,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  accepted_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL CHECK (deadline_at > accepted_at),
  completed_at timestamptz,
  FOREIGN KEY (run_id, task_id, agent_id, binding_id, session_id, adapter_kind)
    REFERENCES agent_world.runs(id, task_id, agent_id, binding_id, session_id, adapter_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (binding_id, route_id, agent_id, adapter_kind)
    REFERENCES agent_world.runtime_bindings(id, route_id, agent_id, adapter_kind)
    ON DELETE RESTRICT,
  CHECK (
    (status = 'EXECUTING' AND result IS NULL AND input_tokens IS NULL
      AND cached_input_tokens IS NULL AND output_tokens IS NULL AND cost_usd IS NULL
      AND cost_source IS NULL AND cost_estimated IS NULL AND failure_code IS NULL
      AND completed_at IS NULL)
    OR
    (status = 'COMPLETED' AND result IS NOT NULL AND input_tokens IS NOT NULL
      AND cached_input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND failure_code IS NULL AND completed_at IS NOT NULL
      AND ((cost_usd IS NULL AND cost_source IS NULL AND cost_estimated IS NULL)
        OR (cost_usd IS NOT NULL AND cost_source IS NOT NULL AND cost_estimated IS NOT NULL)))
    OR
    (status = 'FAILED' AND result IS NULL AND input_tokens IS NULL
      AND cached_input_tokens IS NULL AND output_tokens IS NULL AND cost_usd IS NULL
      AND cost_source IS NULL AND cost_estimated IS NULL AND failure_code IS NOT NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE INDEX model_execution_jobs_active_deadline
  ON agent_world.model_execution_jobs (deadline_at, id) WHERE status = 'EXECUTING';
