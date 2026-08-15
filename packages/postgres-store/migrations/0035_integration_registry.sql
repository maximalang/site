ALTER TABLE agent_world.encrypted_secrets
  DROP CONSTRAINT encrypted_secrets_purpose_check,
  ADD CONSTRAINT encrypted_secrets_purpose_check
    CHECK (purpose IN ('PROVIDER_API_KEY', 'INTEGRATION_CREDENTIAL'));

CREATE TABLE agent_world.integration_endpoints (
  id text PRIMARY KEY CHECK (id ~ '^integration_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  kind text NOT NULL CHECK (kind IN ('MCP', 'N8N', 'GITHUB', 'SSH')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  transport text NOT NULL CHECK (transport IN ('HTTPS', 'SSH')),
  endpoint_url text,
  ssh_host text,
  ssh_port integer,
  ssh_username text,
  credential_ref text REFERENCES agent_world.encrypted_secrets(secret_ref) ON DELETE RESTRICT,
  health text NOT NULL DEFAULT 'UNCONFIGURED' CHECK (health IN ('UNCONFIGURED', 'READY', 'ERROR')),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  CHECK (
    (transport = 'HTTPS' AND kind <> 'SSH' AND endpoint_url IS NOT NULL
      AND ssh_host IS NULL AND ssh_port IS NULL AND ssh_username IS NULL)
    OR
    (transport = 'SSH' AND kind = 'SSH' AND endpoint_url IS NULL
      AND ssh_host IS NOT NULL AND ssh_port BETWEEN 1 AND 65535 AND ssh_username IS NOT NULL)
  )
);

CREATE TABLE agent_world.integration_command_receipts (
  command_id text PRIMARY KEY CHECK (char_length(command_id) BETWEEN 1 AND 512),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  integration_id text NOT NULL REFERENCES agent_world.integration_endpoints(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL
);
