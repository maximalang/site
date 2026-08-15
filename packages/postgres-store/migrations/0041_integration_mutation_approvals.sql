CREATE TABLE agent_world.integration_mutation_requests (
  id text PRIMARY KEY CHECK (
    id ~ '^integration_mutation_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  integration_id text NOT NULL REFERENCES agent_world.integration_endpoints(id) ON DELETE RESTRICT,
  mutation_kind text NOT NULL CHECK (
    mutation_kind = 'GITHUB_DISPATCH_WORKFLOW'
  ),
  mutation jsonb NOT NULL CHECK (
    jsonb_typeof(mutation) = 'object' AND mutation->>'kind' = mutation_kind
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  request_command_id text NOT NULL UNIQUE CHECK (
    char_length(request_command_id) BETWEEN 1 AND 512
  ),
  state text NOT NULL CHECK (
    state IN ('PENDING', 'DENIED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN')
  ),
  decision text CHECK (decision IS NULL OR decision IN ('APPROVE', 'DENY')),
  decision_command_id text UNIQUE CHECK (
    decision_command_id IS NULL OR char_length(decision_command_id) BETWEEN 1 AND 512
  ),
  decision_sha256 text CHECK (
    decision_sha256 IS NULL OR decision_sha256 ~ '^[a-f0-9]{64}$'
  ),
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  completed_at timestamptz,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CHECK (
    (state = 'PENDING' AND decision IS NULL AND decision_command_id IS NULL
      AND decision_sha256 IS NULL AND decided_at IS NULL AND completed_at IS NULL
      AND failure_code IS NULL)
    OR
    (state = 'DENIED' AND decision = 'DENY' AND decision_command_id IS NOT NULL
      AND decision_sha256 IS NOT NULL AND decided_at >= requested_at
      AND completed_at = decided_at AND failure_code = 'OWNER_DENIED')
    OR
    (state = 'EXECUTING' AND decision = 'APPROVE' AND decision_command_id IS NOT NULL
      AND decision_sha256 IS NOT NULL AND decided_at >= requested_at
      AND completed_at IS NULL AND failure_code IS NULL)
    OR
    (state = 'SUCCEEDED' AND decision = 'APPROVE' AND decision_command_id IS NOT NULL
      AND decision_sha256 IS NOT NULL AND decided_at >= requested_at
      AND completed_at >= decided_at AND failure_code IS NULL)
    OR
    (state IN ('FAILED', 'OUTCOME_UNKNOWN') AND decision = 'APPROVE'
      AND decision_command_id IS NOT NULL AND decision_sha256 IS NOT NULL
      AND decided_at >= requested_at AND completed_at >= decided_at
      AND failure_code IS NOT NULL)
  )
);

CREATE INDEX integration_mutation_requests_pending
  ON agent_world.integration_mutation_requests (requested_at, id)
  WHERE state = 'PENDING';

CREATE INDEX integration_mutation_requests_integration_time
  ON agent_world.integration_mutation_requests (integration_id, requested_at DESC);
