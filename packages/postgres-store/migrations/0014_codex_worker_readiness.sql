CREATE TABLE agent_world.codex_worker_readiness (
  worker_id text PRIMARY KEY CHECK (
    char_length(worker_id) BETWEEN 1 AND 128
    AND worker_id !~ '[[:cntrl:]]'
  ),
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  authentication text NOT NULL CHECK (authentication IN ('CHATGPT', 'UNAVAILABLE')),
  checked_at timestamptz NOT NULL,
  authenticated_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK (authenticated_at IS NULL OR authenticated_at <= checked_at),
  UNIQUE (worker_id, account_id)
);

CREATE INDEX codex_worker_readiness_account
  ON agent_world.codex_worker_readiness (account_id, authentication, checked_at DESC);
