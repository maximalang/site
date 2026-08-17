CREATE TABLE agent_world.integration_ssh_operation_allowlist (
  id text PRIMARY KEY CHECK (
    id ~ '^integration_ssh_operation_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  integration_id text NOT NULL REFERENCES agent_world.integration_endpoints(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  operation_kind text NOT NULL CHECK (
    operation_kind IN ('SYSTEMD_RESTART', 'DOCKER_COMPOSE_DEPLOY')
  ),
  systemd_unit text CHECK (
    systemd_unit IS NULL OR (
      char_length(systemd_unit) BETWEEN 1 AND 160
      AND systemd_unit ~ '^[A-Za-z0-9_.@:-]+\.(service|socket|timer|target)$'
    )
  ),
  compose_project text CHECK (
    compose_project IS NULL OR (
      char_length(compose_project) BETWEEN 1 AND 63
      AND compose_project ~ '^[a-z0-9][a-z0-9_-]*$'
    )
  ),
  working_directory text CHECK (
    working_directory IS NULL OR (
      char_length(working_directory) BETWEEN 2 AND 512
      AND working_directory ~ '^/([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$'
      AND working_directory !~ '(^|/)\.\.?($|/)'
    )
  ),
  host_key_sha256 text NOT NULL CHECK (
    host_key_sha256 ~ '^SHA256:[A-Za-z0-9+/]{43}$'
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  UNIQUE (id, integration_id),
  CHECK (
    (operation_kind = 'SYSTEMD_RESTART' AND systemd_unit IS NOT NULL
      AND compose_project IS NULL AND working_directory IS NULL)
    OR
    (operation_kind = 'DOCKER_COMPOSE_DEPLOY' AND systemd_unit IS NULL
      AND compose_project IS NOT NULL AND working_directory IS NOT NULL)
  )
);

CREATE TABLE agent_world.integration_ssh_operation_receipts (
  command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 512),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  ssh_operation_id text NOT NULL REFERENCES agent_world.integration_ssh_operation_allowlist(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL
);

CREATE INDEX integration_ssh_operation_integration
  ON agent_world.integration_ssh_operation_allowlist (integration_id, created_at, id)
  WHERE is_enabled = true;

ALTER TABLE agent_world.integration_mutation_requests
  DROP CONSTRAINT integration_mutation_requests_mutation_kind_check,
  ADD CONSTRAINT integration_mutation_requests_mutation_kind_check CHECK (
    mutation_kind IN (
      'GITHUB_DISPATCH_WORKFLOW',
      'MCP_CALL_REGISTERED_TOOL',
      'SSH_RUN_REGISTERED_OPERATION'
    )
  );
