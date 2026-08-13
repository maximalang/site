CREATE TABLE agent_world.hub_command_receipts (
  id text PRIMARY KEY CHECK (
    id ~ '^hub_command_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  kind text NOT NULL CHECK (kind IN (
    'PROVIDER_CREATE', 'ACCOUNT_CREATE', 'CANONICAL_MODEL_CREATE',
    'MODEL_ROUTE_CREATE', 'AGENT_CREATE', 'SKILL_CREATE', 'TOOL_CREATE',
    'PROJECT_CREATE'
  )),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL CHECK (
    jsonb_typeof(response) = 'object'
    AND response ->> 'schemaVersion' = '1'
    AND response ->> 'outcome' = 'CREATED'
    AND response ->> 'commandId' = id
    AND jsonb_typeof(response -> 'resource') = 'object'
  ),
  created_at timestamptz NOT NULL
);

CREATE INDEX hub_command_receipts_created_at
  ON agent_world.hub_command_receipts (created_at, id);
