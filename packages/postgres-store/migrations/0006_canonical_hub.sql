CREATE TABLE agent_world.providers (
  id text PRIMARY KEY CHECK (id ~ '^provider_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  slug text NOT NULL UNIQUE CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND char_length(slug) <= 63
  ),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  kind text NOT NULL CHECK (kind IN (
    'OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENROUTER', 'XAI', 'DEEPSEEK',
    'MISTRAL', 'GROQ', 'AZURE_OPENAI', 'AWS_BEDROCK', 'OLLAMA',
    'LM_STUDIO', 'OPENCLAW', 'CUSTOM_OPENAI_COMPATIBLE', 'OTHER'
  )),
  category text NOT NULL CHECK (category IN (
    'LLM_API', 'CONSUMER_ACCOUNT', 'LOCAL_MODEL', 'RUNTIME_GATEWAY'
  )),
  base_url text CHECK (
    base_url IS NULL OR (
      char_length(base_url) BETWEEN 1 AND 2048
      AND base_url ~ '^https?://'
      AND base_url !~ '[[:cntrl:]#?]'
      AND base_url !~ '^https?://[^/]*@'
    )
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO agent_world.providers
  (id, slug, display_name, kind, category)
VALUES
  ('provider_00000000-0000-0000-0000-000000000001',
   'openclaw', 'OpenClaw', 'OPENCLAW', 'RUNTIME_GATEWAY');

ALTER TABLE agent_world.accounts
  ADD COLUMN provider_id text,
  ADD COLUMN auth_mechanism text,
  ADD COLUMN subscription text CHECK (
    subscription IS NULL OR char_length(btrim(subscription)) BETWEEN 1 AND 100
  ),
  ADD COLUMN health text,
  ADD COLUMN credential_ref text CHECK (
    credential_ref IS NULL OR (
      char_length(credential_ref) BETWEEN 1 AND 512
      AND credential_ref ~ '^(env|secret-store|vault):[A-Za-z0-9][A-Za-z0-9._/-]*$'
    )
  ),
  ADD COLUMN last_successful_auth_at timestamptz,
  ADD COLUMN is_enabled boolean NOT NULL DEFAULT true;

UPDATE agent_world.accounts
   SET provider_id = 'provider_00000000-0000-0000-0000-000000000001',
       auth_mechanism = 'TOKEN',
       health = 'UNCONFIGURED';

ALTER TABLE agent_world.accounts
  ALTER COLUMN provider_id SET NOT NULL,
  ALTER COLUMN auth_mechanism SET NOT NULL,
  ALTER COLUMN health SET NOT NULL,
  ADD CONSTRAINT accounts_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES agent_world.providers(id) ON DELETE RESTRICT,
  ADD CONSTRAINT accounts_auth_mechanism_check CHECK (auth_mechanism IN (
    'API_KEY', 'OAUTH', 'CHATGPT_INTERACTIVE', 'TOKEN', 'DEVICE_TOKEN', 'NONE'
  )),
  ADD CONSTRAINT accounts_health_check CHECK (health IN (
    'ACTIVE', 'DEGRADED', 'EXHAUSTED', 'DISABLED', 'UNCONFIGURED'
  )),
  ADD CONSTRAINT accounts_provider_identity_key UNIQUE (id, provider_id);

CREATE TABLE agent_world.account_surfaces (
  account_id text NOT NULL REFERENCES agent_world.accounts(id) ON DELETE CASCADE,
  surface text NOT NULL CHECK (surface IN ('CHAT', 'WORK', 'CODEX', 'API', 'LOCAL')),
  PRIMARY KEY (account_id, surface)
);

INSERT INTO agent_world.account_surfaces (account_id, surface)
SELECT id, 'CHAT'
  FROM agent_world.accounts
UNION
SELECT account_id, mode
  FROM agent_world.execution_routes
 WHERE account_id IS NOT NULL;

ALTER TABLE agent_world.execution_routes
  ADD CONSTRAINT execution_routes_account_surface_fkey
    FOREIGN KEY (account_id, mode)
    REFERENCES agent_world.account_surfaces(account_id, surface)
    ON DELETE RESTRICT;

CREATE TABLE agent_world.canonical_models (
  id text PRIMARY KEY CHECK (id ~ '^model_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  slug text NOT NULL UNIQUE CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND char_length(slug) <= 63
  ),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  family text NOT NULL CHECK (char_length(btrim(family)) BETWEEN 1 AND 100),
  reasoning boolean NOT NULL,
  tool_use boolean NOT NULL,
  context_window_tokens bigint NOT NULL CHECK (context_window_tokens BETWEEN 1 AND 100000000),
  max_output_tokens bigint CHECK (max_output_tokens BETWEEN 1 AND 10000000),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world.canonical_model_modalities (
  canonical_model_id text NOT NULL REFERENCES agent_world.canonical_models(id) ON DELETE CASCADE,
  modality text NOT NULL CHECK (modality IN (
    'TEXT', 'IMAGE_INPUT', 'AUDIO_INPUT', 'VIDEO_INPUT', 'IMAGE_OUTPUT', 'AUDIO_OUTPUT'
  )),
  PRIMARY KEY (canonical_model_id, modality)
);

CREATE TABLE agent_world.skills (
  id text PRIMARY KEY CHECK (id ~ '^skill_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  slug text NOT NULL CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND char_length(slug) <= 63
  ),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  version text NOT NULL CHECK (
    char_length(version) <= 64
    AND version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  ),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
  source_kind text NOT NULL CHECK (source_kind IN ('BUILTIN', 'LOCAL_PATH', 'GIT', 'OPENCLAW')),
  source_ref text NOT NULL CHECK (
    char_length(source_ref) BETWEEN 1 AND 512
    AND source_ref !~ '[[:cntrl:]]'
  ),
  integrity_sha256 text NOT NULL CHECK (integrity_sha256 ~ '^[a-f0-9]{64}$'),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (slug, version)
);

CREATE TABLE agent_world.tools (
  id text PRIMARY KEY CHECK (id ~ '^tool_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  slug text NOT NULL UNIQUE CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND char_length(slug) <= 63
  ),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('MCP', 'HTTP', 'CLI', 'BROWSER', 'DATABASE', 'OTHER')),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
  configuration_ref text CHECK (
    configuration_ref IS NULL OR (
      char_length(configuration_ref) BETWEEN 1 AND 512
      AND configuration_ref ~ '^(env|secret-store|vault):[A-Za-z0-9][A-Za-z0-9._/-]*$'
    )
  ),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE agent_world.model_routes (
  id text PRIMARY KEY CHECK (id ~ '^model_route_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  canonical_model_id text NOT NULL REFERENCES agent_world.canonical_models(id) ON DELETE RESTRICT,
  provider_id text NOT NULL REFERENCES agent_world.providers(id) ON DELETE RESTRICT,
  account_id text,
  surface text NOT NULL CHECK (surface IN ('CHAT', 'WORK', 'CODEX', 'API', 'LOCAL')),
  remote_model_id text NOT NULL CHECK (
    char_length(remote_model_id) BETWEEN 1 AND 512
    AND remote_model_id !~ '[[:cntrl:]]'
  ),
  availability text NOT NULL CHECK (availability IN (
    'AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'
  )),
  price_currency text,
  input_price_per_million numeric(18, 8),
  output_price_per_million numeric(18, 8),
  requests_per_minute integer CHECK (requests_per_minute > 0),
  tokens_per_minute bigint CHECK (tokens_per_minute > 0),
  latency_p50_ms numeric(14, 3) CHECK (latency_p50_ms >= 0),
  quality_score numeric(5, 2) CHECK (quality_score BETWEEN 0 AND 100),
  context_window_tokens bigint NOT NULL CHECK (context_window_tokens BETWEEN 1 AND 100000000),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (account_id, provider_id)
    REFERENCES agent_world.accounts(id, provider_id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id, surface)
    REFERENCES agent_world.account_surfaces(account_id, surface) ON DELETE RESTRICT,
  CHECK (
    (price_currency IS NULL
      AND input_price_per_million IS NULL
      AND output_price_per_million IS NULL)
    OR
    (price_currency = 'USD'
      AND input_price_per_million >= 0
      AND output_price_per_million >= 0)
  ),
  UNIQUE NULLS NOT DISTINCT (provider_id, account_id, surface, remote_model_id)
);

CREATE TABLE agent_world.model_route_reasoning_efforts (
  model_route_id text NOT NULL REFERENCES agent_world.model_routes(id) ON DELETE CASCADE,
  effort text NOT NULL CHECK (effort IN ('MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH')),
  PRIMARY KEY (model_route_id, effort)
);

CREATE TABLE agent_world.model_route_modalities (
  model_route_id text NOT NULL REFERENCES agent_world.model_routes(id) ON DELETE CASCADE,
  modality text NOT NULL CHECK (modality IN (
    'TEXT', 'IMAGE_INPUT', 'AUDIO_INPUT', 'VIDEO_INPUT', 'IMAGE_OUTPUT', 'AUDIO_OUTPUT'
  )),
  PRIMARY KEY (model_route_id, modality)
);

CREATE TABLE agent_world.model_route_tools (
  model_route_id text NOT NULL REFERENCES agent_world.model_routes(id) ON DELETE CASCADE,
  tool_id text NOT NULL REFERENCES agent_world.tools(id) ON DELETE RESTRICT,
  PRIMARY KEY (model_route_id, tool_id)
);

ALTER TABLE agent_world.execution_routes
  ADD COLUMN model_route_id text REFERENCES agent_world.model_routes(id) ON DELETE RESTRICT;

ALTER TABLE agent_world.agents
  ADD COLUMN preferred_route_id text REFERENCES agent_world.execution_routes(id) ON DELETE RESTRICT;

CREATE TABLE agent_world.agent_skills (
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE CASCADE,
  skill_id text NOT NULL REFERENCES agent_world.skills(id) ON DELETE RESTRICT,
  priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 1000),
  is_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE agent_world.agent_tools (
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE CASCADE,
  tool_id text NOT NULL REFERENCES agent_world.tools(id) ON DELETE RESTRICT,
  is_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (agent_id, tool_id)
);

ALTER TABLE agent_world.projects
  ADD COLUMN slug text,
  ADD COLUMN description text CHECK (
    description IS NULL OR char_length(btrim(description)) BETWEEN 1 AND 4000
  ),
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

UPDATE agent_world.projects
   SET slug = regexp_replace(id, '^project_', 'project-');

ALTER TABLE agent_world.projects
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT projects_slug_key UNIQUE (slug),
  ADD CONSTRAINT projects_slug_check CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND char_length(slug) <= 63
  );

CREATE TABLE agent_world.project_agents (
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (project_id, agent_id)
);

INSERT INTO agent_world.project_agents (project_id, agent_id, created_at)
SELECT project_id, agent_id, min(created_at)
  FROM agent_world.conversations
 GROUP BY project_id, agent_id;

ALTER TABLE agent_world.conversations
  ADD CONSTRAINT conversations_project_agent_fkey
    FOREIGN KEY (project_id, agent_id)
    REFERENCES agent_world.project_agents(project_id, agent_id)
    ON DELETE RESTRICT;

CREATE INDEX model_routes_canonical_model
  ON agent_world.model_routes (canonical_model_id, availability, id);

CREATE INDEX project_agents_by_agent
  ON agent_world.project_agents (agent_id, project_id);
