CREATE TABLE agent_world.encrypted_secrets (
  secret_ref text PRIMARY KEY CHECK (
    char_length(secret_ref) BETWEEN 14 AND 512
    AND secret_ref ~ '^secret-store:[A-Za-z0-9][A-Za-z0-9._/-]*$'
  ),
  purpose text NOT NULL CHECK (purpose IN ('PROVIDER_API_KEY')),
  version integer NOT NULL CHECK (version > 0),
  algorithm text NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  key_version integer NOT NULL CHECK (key_version > 0),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 16384),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  created_at timestamptz NOT NULL,
  rotated_at timestamptz NOT NULL CHECK (rotated_at >= created_at)
);

CREATE TABLE agent_world.secret_write_receipts (
  command_id text PRIMARY KEY CHECK (
    char_length(command_id) BETWEEN 1 AND 512
    AND command_id !~ '[[:cntrl:]]'
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  secret_ref text NOT NULL REFERENCES agent_world.encrypted_secrets(secret_ref) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  outcome text NOT NULL CHECK (outcome IN ('CREATED', 'ROTATED')),
  created_at timestamptz NOT NULL
);
