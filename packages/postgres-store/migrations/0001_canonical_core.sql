CREATE TABLE agent_world.accounts (
  id text PRIMARY KEY CHECK (id ~ '^account_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world.projects (
  id text PRIMARY KEY CHECK (id ~ '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world.agents (
  id text PRIMARY KEY CHECK (id ~ '^agent_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) <= 63),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  role text NOT NULL CHECK (char_length(btrim(role)) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK (char_length(btrim(instructions)) BETWEEN 1 AND 32000),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world.execution_routes (
  id text PRIMARY KEY CHECK (id ~ '^route_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
  mode text NOT NULL CHECK (mode IN ('CHAT', 'WORK', 'CODEX', 'API', 'LOCAL')),
  adapter_kind text NOT NULL CHECK (adapter_kind IN ('OPENCLAW', 'CODEX', 'API_MODEL', 'LOCAL_MODEL', 'NATIVE_CHATGPT', 'NATIVE_WORK')),
  account_id text REFERENCES agent_world.accounts(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world.runtime_bindings (
  id text PRIMARY KEY CHECK (id ~ '^binding_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  route_id text NOT NULL REFERENCES agent_world.execution_routes(id) ON DELETE RESTRICT,
  adapter_kind text NOT NULL CHECK (adapter_kind IN ('OPENCLAW', 'CODEX', 'API_MODEL', 'LOCAL_MODEL', 'NATIVE_CHATGPT', 'NATIVE_WORK')),
  external_agent_id text NOT NULL CHECK (
    char_length(external_agent_id) BETWEEN 1 AND 512
    AND external_agent_id !~ '[[:cntrl:]]'
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (route_id, external_agent_id),
  UNIQUE (id, agent_id, adapter_kind)
);

CREATE TABLE agent_world.conversations (
  id text PRIMARY KEY CHECK (id ~ '^conversation_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  title text CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL,
  UNIQUE (id, agent_id)
);

CREATE TABLE agent_world.conversation_sessions (
  id text PRIMARY KEY CHECK (id ~ '^session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  conversation_id text NOT NULL,
  agent_id text NOT NULL,
  binding_id text NOT NULL,
  adapter_kind text NOT NULL CHECK (adapter_kind IN ('OPENCLAW', 'CODEX', 'API_MODEL', 'LOCAL_MODEL', 'NATIVE_CHATGPT', 'NATIVE_WORK')),
  external_session_ref text NOT NULL CHECK (
    char_length(external_session_ref) BETWEEN 1 AND 512
    AND external_session_ref !~ '[[:cntrl:]]'
  ),
  started_at timestamptz NOT NULL,
  ended_at timestamptz CHECK (ended_at IS NULL OR ended_at >= started_at),
  FOREIGN KEY (conversation_id, agent_id) REFERENCES agent_world.conversations(id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_id, agent_id, adapter_kind) REFERENCES agent_world.runtime_bindings(id, agent_id, adapter_kind) ON DELETE RESTRICT,
  UNIQUE (id, conversation_id, agent_id)
);

CREATE UNIQUE INDEX conversation_sessions_one_active
  ON agent_world.conversation_sessions (conversation_id)
  WHERE ended_at IS NULL;

CREATE TABLE agent_world.conversation_messages (
  id text PRIMARY KEY CHECK (id ~ '^message_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  conversation_id text NOT NULL,
  session_id text NOT NULL,
  agent_id text NOT NULL,
  author text NOT NULL CHECK (author IN ('OWNER', 'AGENT')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 32000 AND char_length(btrim(content)) > 0),
  delivery text NOT NULL CHECK (delivery IN ('ACCEPTED', 'DISPATCHED', 'FAILED', 'RECEIVED')),
  created_at timestamptz NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('DOMAIN', 'RUNTIME')),
  command_id text,
  adapter_kind text,
  binding_id text,
  external_message_id text,
  idempotency_key text UNIQUE,
  accepted_at timestamptz,
  dispatched_at timestamptz,
  failed_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code IN ('ADAPTER_UNAVAILABLE', 'ADAPTER_REJECTED')),
  external_request_id text,
  FOREIGN KEY (session_id, conversation_id, agent_id) REFERENCES agent_world.conversation_sessions(id, conversation_id, agent_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_id, agent_id, adapter_kind) REFERENCES agent_world.runtime_bindings(id, agent_id, adapter_kind) ON DELETE RESTRICT,
  CHECK (
    (author = 'OWNER' AND source_kind = 'DOMAIN' AND delivery IN ('ACCEPTED', 'DISPATCHED', 'FAILED')
      AND command_id IS NOT NULL AND idempotency_key = command_id
      AND adapter_kind IS NULL AND binding_id IS NULL AND external_message_id IS NULL)
    OR
    (author = 'AGENT' AND source_kind = 'RUNTIME' AND delivery = 'RECEIVED'
      AND command_id IS NULL AND idempotency_key IS NULL
      AND adapter_kind IS NOT NULL AND binding_id IS NOT NULL AND external_message_id IS NOT NULL
      AND accepted_at IS NULL AND dispatched_at IS NULL AND failed_at IS NULL
      AND failure_code IS NULL AND external_request_id IS NULL)
  ),
  CHECK (
    (delivery = 'ACCEPTED' AND accepted_at IS NOT NULL AND dispatched_at IS NULL AND failed_at IS NULL AND failure_code IS NULL)
    OR
    (delivery = 'DISPATCHED' AND accepted_at IS NOT NULL AND dispatched_at IS NOT NULL AND failed_at IS NULL AND failure_code IS NULL)
    OR
    (delivery = 'FAILED' AND accepted_at IS NOT NULL AND dispatched_at IS NULL AND failed_at IS NOT NULL AND failure_code IS NOT NULL)
    OR
    (delivery = 'RECEIVED')
  )
);

CREATE FUNCTION agent_world.enforce_message_session_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_binding_id text;
  session_adapter_kind text;
BEGIN
  IF NEW.author = 'AGENT' THEN
    SELECT binding_id, adapter_kind
      INTO session_binding_id, session_adapter_kind
      FROM agent_world.conversation_sessions
      WHERE id = NEW.session_id;
    IF session_binding_id IS DISTINCT FROM NEW.binding_id
      OR session_adapter_kind IS DISTINCT FROM NEW.adapter_kind THEN
      RAISE EXCEPTION 'Agent message provenance does not match its conversation session'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_messages_session_provenance
BEFORE INSERT OR UPDATE OF session_id, author, binding_id, adapter_kind
ON agent_world.conversation_messages
FOR EACH ROW
EXECUTE FUNCTION agent_world.enforce_message_session_provenance();

CREATE INDEX conversation_messages_timeline
  ON agent_world.conversation_messages (conversation_id, created_at, id);
