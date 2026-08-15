CREATE TABLE agent_world.integration_tool_allowlist (
  id text PRIMARY KEY CHECK (
    id ~ '^integration_tool_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  integration_id text NOT NULL REFERENCES agent_world.integration_endpoints(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  tool_name text NOT NULL CHECK (
    char_length(btrim(tool_name)) BETWEEN 1 AND 120 AND tool_name ~ '^[A-Za-z0-9._:-]+$'
  ),
  fixed_arguments jsonb NOT NULL CHECK (
    jsonb_typeof(fixed_arguments) = 'object'
    AND jsonb_array_length(jsonb_path_query_array(fixed_arguments, '$.keyvalue()')) <= 50
    AND octet_length(fixed_arguments::text) <= 8192
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  UNIQUE (id, integration_id),
  UNIQUE (integration_id, tool_name, fixed_arguments)
);

CREATE TABLE agent_world.integration_tool_allowlist_receipts (
  command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 512),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  tool_allowlist_id text NOT NULL REFERENCES agent_world.integration_tool_allowlist(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL
);

CREATE INDEX integration_tool_allowlist_integration
  ON agent_world.integration_tool_allowlist (integration_id, created_at, id)
  WHERE is_enabled = true;

ALTER TABLE agent_world.integration_mutation_requests
  DROP CONSTRAINT integration_mutation_requests_mutation_kind_check,
  ADD CONSTRAINT integration_mutation_requests_mutation_kind_check CHECK (
    mutation_kind IN ('GITHUB_DISPATCH_WORKFLOW', 'MCP_CALL_REGISTERED_TOOL')
  );
