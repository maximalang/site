CREATE TABLE agent_world.resource_route_observations (
  route_id text NOT NULL REFERENCES agent_world.execution_routes(id) ON DELETE CASCADE,
  account_id text REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  adapter_kind text NOT NULL,
  mode text NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  is_available boolean NOT NULL,
  quality numeric(7,6) NOT NULL CHECK (quality BETWEEN 0 AND 1),
  remaining_limits numeric(7,6) NOT NULL CHECK (remaining_limits BETWEEN 0 AND 1),
  cost numeric(7,6) NOT NULL CHECK (cost BETWEEN 0 AND 1),
  speed numeric(7,6) NOT NULL CHECK (speed BETWEEN 0 AND 1),
  load numeric(7,6) NOT NULL CHECK (load BETWEEN 0 AND 1),
  source_kind text NOT NULL CHECK (source_kind IN (
    'AUTH', 'LAUNCHER', 'HEALTHCHECK', 'TELEMETRY', 'OWNER'
  )),
  source_ref text NOT NULL CHECK (
    char_length(source_ref) BETWEEN 1 AND 512 AND source_ref !~ '[[:cntrl:]]'
  ),
  PRIMARY KEY (route_id, observed_at),
  CHECK (expires_at > observed_at)
);

CREATE TABLE agent_world.resource_broker_decisions (
  id text PRIMARY KEY CHECK (
    id ~ '^broker_decision_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  task_id text NOT NULL REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  policy_version text NOT NULL CHECK (
    char_length(policy_version) BETWEEN 1 AND 100
    AND policy_version ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  decision jsonb NOT NULL CHECK (jsonb_typeof(decision) = 'object'),
  decision_sha256 text NOT NULL CHECK (decision_sha256 ~ '^[a-f0-9]{64}$'),
  selected_route_id text REFERENCES agent_world.execution_routes(id) ON DELETE RESTRICT,
  selected_account_id text REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  selected_adapter_kind text,
  selected_mode text,
  selected_score numeric(7,6) CHECK (selected_score BETWEEN 0 AND 1),
  fallback_reason text CHECK (fallback_reason IN ('NO_ELIGIBLE_ROUTE')),
  decided_at timestamptz NOT NULL,
  UNIQUE (task_id, id),
  CHECK (
    (selected_route_id IS NOT NULL AND selected_adapter_kind IS NOT NULL
      AND selected_mode IS NOT NULL AND selected_score IS NOT NULL
      AND fallback_reason IS NULL)
    OR
    (selected_route_id IS NULL AND selected_account_id IS NULL
      AND selected_adapter_kind IS NULL AND selected_mode IS NULL
      AND selected_score IS NULL AND fallback_reason = 'NO_ELIGIBLE_ROUTE')
  )
);

CREATE INDEX resource_route_observations_latest
  ON agent_world.resource_route_observations (route_id, observed_at DESC);

CREATE INDEX resource_broker_decisions_task_timeline
  ON agent_world.resource_broker_decisions (task_id, decided_at, id);
