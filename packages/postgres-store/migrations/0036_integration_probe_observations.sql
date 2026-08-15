CREATE TABLE agent_world.integration_probe_observations (
  command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 512),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  integration_id text NOT NULL REFERENCES agent_world.integration_endpoints(id) ON DELETE RESTRICT,
  health text NOT NULL CHECK (health IN ('READY', 'ERROR')),
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 120 AND code !~ '[[:cntrl:]]'),
  checked_at timestamptz NOT NULL
);

CREATE INDEX integration_probe_observations_timeline
  ON agent_world.integration_probe_observations (integration_id, checked_at DESC, command_id);
