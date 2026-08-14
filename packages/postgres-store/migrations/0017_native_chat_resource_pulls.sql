CREATE TABLE agent_world.native_chat_resource_pulls (
  id text PRIMARY KEY CHECK (
    id ~ '^resource_pull_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  run_id text NOT NULL REFERENCES agent_world.native_chat_dispatches(run_id) ON DELETE RESTRICT,
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  requested_resources jsonb NOT NULL CHECK (
    jsonb_typeof(requested_resources) = 'array'
    AND jsonb_array_length(requested_resources) BETWEEN 1 AND 7
  ),
  query_sha256 text CHECK (query_sha256 IS NULL OR query_sha256 ~ '^[a-f0-9]{64}$'),
  max_items integer NOT NULL CHECK (max_items BETWEEN 1 AND 100),
  max_tokens integer NOT NULL CHECK (max_tokens BETWEEN 64 AND 100000),
  returned_items integer NOT NULL CHECK (returned_items BETWEEN 0 AND max_items),
  estimated_tokens integer NOT NULL CHECK (estimated_tokens BETWEEN 0 AND max_tokens),
  response_sha256 text NOT NULL CHECK (response_sha256 ~ '^[a-f0-9]{64}$'),
  pulled_at timestamptz NOT NULL
);

CREATE INDEX native_chat_resource_pulls_timeline
  ON agent_world.native_chat_resource_pulls (run_id, pulled_at, id);
