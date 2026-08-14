CREATE TABLE agent_world.agent_templates (
  id text NOT NULL CHECK (id ~ '^agent_template_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 1000000),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) <= 63),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  role text NOT NULL CHECK (char_length(btrim(role)) BETWEEN 1 AND 160),
  instructions text NOT NULL CHECK (char_length(btrim(instructions)) BETWEEN 1 AND 32000),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id, version),
  UNIQUE (slug, version)
);

CREATE TABLE agent_world.agent_template_skills (
  agent_template_id text NOT NULL,
  agent_template_version integer NOT NULL,
  skill_id text NOT NULL REFERENCES agent_world.skills(id) ON DELETE RESTRICT,
  PRIMARY KEY (agent_template_id, agent_template_version, skill_id),
  FOREIGN KEY (agent_template_id, agent_template_version)
    REFERENCES agent_world.agent_templates(id, version) ON DELETE CASCADE
);

CREATE TABLE agent_world.agent_template_tools (
  agent_template_id text NOT NULL,
  agent_template_version integer NOT NULL,
  tool_id text NOT NULL REFERENCES agent_world.tools(id) ON DELETE RESTRICT,
  PRIMARY KEY (agent_template_id, agent_template_version, tool_id),
  FOREIGN KEY (agent_template_id, agent_template_version)
    REFERENCES agent_world.agent_templates(id, version) ON DELETE CASCADE
);

ALTER TABLE agent_world.agents
  ADD COLUMN template_id text,
  ADD COLUMN template_version integer,
  ADD CONSTRAINT agents_template_shape_check CHECK (
    (template_id IS NULL AND template_version IS NULL)
    OR (template_id IS NOT NULL AND template_version IS NOT NULL)
  ),
  ADD CONSTRAINT agents_template_fkey FOREIGN KEY (template_id, template_version)
    REFERENCES agent_world.agent_templates(id, version) ON DELETE RESTRICT;

CREATE TABLE agent_world.missions (
  id text PRIMARY KEY CHECK (id ~ '^mission_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  goal text NOT NULL CHECK (char_length(btrim(goal)) BETWEEN 1 AND 20000),
  status text NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (id, project_id)
);

CREATE TABLE agent_world.mission_success_criteria (
  id text PRIMARY KEY CHECK (id ~ '^mission_criterion_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  mission_id text NOT NULL REFERENCES agent_world.missions(id) ON DELETE CASCADE,
  criterion_position integer NOT NULL CHECK (criterion_position BETWEEN 0 AND 99),
  statement text NOT NULL CHECK (char_length(btrim(statement)) BETWEEN 1 AND 2000),
  verification text NOT NULL CHECK (verification IN ('ARTIFACT', 'METRIC', 'TEST', 'OWNER_CONFIRMATION')),
  status text NOT NULL CHECK (status IN ('PENDING', 'PASSED', 'FAILED')),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence_refs) = 'array' AND jsonb_array_length(evidence_refs) <= 100
  ),
  UNIQUE (id, mission_id),
  UNIQUE (mission_id, criterion_position)
);

CREATE TABLE agent_world.agent_instance_assignments (
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  template_id text NOT NULL,
  template_version integer NOT NULL,
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  mission_id text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (agent_id, project_id),
  FOREIGN KEY (template_id, template_version)
    REFERENCES agent_world.agent_templates(id, version) ON DELETE RESTRICT,
  FOREIGN KEY (mission_id, project_id)
    REFERENCES agent_world.missions(id, project_id) ON DELETE RESTRICT
);

ALTER TABLE agent_world.tasks
  ADD COLUMN mission_id text,
  ADD CONSTRAINT tasks_mission_project_fkey FOREIGN KEY (mission_id, project_id)
    REFERENCES agent_world.missions(id, project_id) ON DELETE RESTRICT;

CREATE INDEX missions_project_status_idx
  ON agent_world.missions (project_id, status, updated_at DESC, id);

CREATE INDEX mission_success_criteria_mission_idx
  ON agent_world.mission_success_criteria (mission_id, id);
