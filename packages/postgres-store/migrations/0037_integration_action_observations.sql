CREATE TABLE agent_world.integration_action_observations (
  command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 512),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  integration_id text NOT NULL REFERENCES agent_world.integration_endpoints(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'MCP_LIST_TOOLS',
    'N8N_LIST_WORKFLOWS',
    'GITHUB_LIST_REPOSITORIES',
    'SSH_INSPECT_HOST'
  )),
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  executed_at timestamptz NOT NULL
);

CREATE INDEX integration_action_observations_integration_time
  ON agent_world.integration_action_observations (integration_id, executed_at DESC);
