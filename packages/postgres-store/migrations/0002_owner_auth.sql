CREATE TABLE agent_world.owner_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX owner_sessions_active_expiry
  ON agent_world.owner_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE agent_world.owner_auth_throttle (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count BETWEEN 0 AND 5),
  blocked_until timestamptz
);
