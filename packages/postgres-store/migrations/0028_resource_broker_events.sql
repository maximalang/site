CREATE TABLE agent_world.resource_broker_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE CHECK (sequence > 0),
  id text PRIMARY KEY CHECK (
    id ~ '^broker_event_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  event_type text NOT NULL CHECK (event_type = 'RESOURCE_ROUTE_DECIDED'),
  task_id text NOT NULL REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  decision_id text NOT NULL UNIQUE REFERENCES agent_world.resource_broker_decisions(id) ON DELETE RESTRICT,
  selected_route_id text REFERENCES agent_world.execution_routes(id) ON DELETE RESTRICT,
  selected_account_id text REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  selected_adapter_kind text,
  selected_mode text,
  selected_score numeric(7,6) CHECK (selected_score BETWEEN 0 AND 1),
  fallback_reason text CHECK (fallback_reason IN ('NO_ELIGIBLE_ROUTE')),
  policy_version text NOT NULL,
  decision_sha256 text NOT NULL CHECK (decision_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
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

CREATE INDEX resource_broker_events_replay
  ON agent_world.resource_broker_events (sequence, id);
