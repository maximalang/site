ALTER TABLE agent_world.tasks
  ADD CONSTRAINT tasks_context_pack_scope_key
  UNIQUE (id, project_id, assignee_agent_id);

ALTER TABLE agent_world.context_items
  ADD CONSTRAINT context_items_project_key UNIQUE (id, project_id);

CREATE TABLE agent_world.context_packs (
  id text PRIMARY KEY CHECK (
    id ~ '^context_pack_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  run_id text NOT NULL UNIQUE,
  task_id text NOT NULL,
  agent_id text NOT NULL,
  project_id text NOT NULL,
  route_id text NOT NULL REFERENCES agent_world.execution_routes(id) ON DELETE RESTRICT,
  compiler_version text NOT NULL CHECK (compiler_version ~ '^\d+\.\d+\.\d+$'),
  token_budget integer NOT NULL CHECK (token_budget BETWEEN 256 AND 1000000),
  estimated_tokens integer NOT NULL CHECK (
    estimated_tokens BETWEEN 0 AND token_budget
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  pack_sha256 text NOT NULL CHECK (pack_sha256 ~ '^[a-f0-9]{64}$'),
  sections jsonb NOT NULL CHECK (
    jsonb_typeof(sections) = 'array' AND jsonb_array_length(sections) = 10
  ),
  rendered text NOT NULL CHECK (char_length(rendered) <= 2000000),
  compiled_at timestamptz NOT NULL,
  UNIQUE (id, project_id),
  FOREIGN KEY (run_id, task_id)
    REFERENCES agent_world.runs(id, task_id) ON DELETE RESTRICT,
  FOREIGN KEY (task_id, project_id, agent_id)
    REFERENCES agent_world.tasks(id, project_id, assignee_agent_id) ON DELETE RESTRICT
);

CREATE TABLE agent_world.context_pack_evidence (
  context_pack_id text NOT NULL,
  project_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 999),
  context_item_id text NOT NULL,
  section text NOT NULL CHECK (section IN (
    'GOAL', 'CURRENT_PROJECT_STATE', 'RELEVANT_DECISIONS', 'RELEVANT_MEMORY',
    'RELEVANT_FINDINGS', 'REQUIRED_SKILLS', 'AVAILABLE_TOOLS',
    'ARTIFACT_REFERENCES', 'EXPECTED_OUTPUT', 'HANDOFF_CONTRACT'
  )),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  score double precision NOT NULL CHECK (score BETWEEN 0 AND 1000),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  PRIMARY KEY (context_pack_id, ordinal),
  UNIQUE (context_pack_id, context_item_id),
  FOREIGN KEY (context_pack_id, project_id)
    REFERENCES agent_world.context_packs(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT
);

CREATE INDEX context_pack_evidence_item
  ON agent_world.context_pack_evidence (context_item_id, context_pack_id);
