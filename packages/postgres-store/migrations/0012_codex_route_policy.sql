CREATE TABLE agent_world.codex_execution_policies (
  route_id text PRIMARY KEY,
  account_id text NOT NULL,
  adapter_kind text NOT NULL DEFAULT 'CODEX' CHECK (adapter_kind = 'CODEX'),
  mode text NOT NULL DEFAULT 'CODEX' CHECK (mode = 'CODEX'),
  working_directory text NOT NULL CHECK (
    char_length(working_directory) BETWEEN 1 AND 4096
    AND working_directory !~ '[[:cntrl:]]'
  ),
  sandbox text NOT NULL CHECK (sandbox IN ('READ_ONLY', 'WORKSPACE_WRITE')),
  approval_policy text NOT NULL CHECK (approval_policy IN ('NEVER', 'ON_REQUEST')),
  network_access boolean NOT NULL DEFAULT false CHECK (network_access = false),
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
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (route_id, account_id, adapter_kind, mode)
    REFERENCES agent_world.execution_routes(id, account_id, adapter_kind, mode)
    ON DELETE RESTRICT
);

CREATE INDEX codex_execution_policies_account
  ON agent_world.codex_execution_policies (account_id, route_id);
