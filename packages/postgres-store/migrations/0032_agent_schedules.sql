CREATE TABLE agent_world.agent_schedules (
  id text PRIMARY KEY CHECK (
    id ~ '^schedule_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  mission_id text,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  task_description text CHECK (
    task_description IS NULL OR char_length(btrim(task_description)) BETWEEN 1 AND 20000
  ),
  cron_expression text NOT NULL CHECK (char_length(btrim(cron_expression)) BETWEEN 9 AND 128),
  timezone text NOT NULL CHECK (
    char_length(btrim(timezone)) BETWEEN 1 AND 100
    AND timezone ~ '^[A-Za-z_+-]+(/[A-Za-z0-9_+-]+)*$'
  ),
  is_enabled boolean NOT NULL,
  next_fire_at timestamptz,
  last_fire_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY (mission_id, project_id)
    REFERENCES agent_world.missions(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, agent_id)
    REFERENCES agent_world.project_agents(project_id, agent_id) ON DELETE RESTRICT,
  CHECK (NOT is_enabled OR next_fire_at IS NOT NULL),
  CHECK (next_fire_at IS NULL OR next_fire_at >= created_at),
  CHECK (last_fire_at IS NULL OR last_fire_at >= created_at)
);

CREATE TABLE agent_world.schedule_firings (
  id text PRIMARY KEY CHECK (
    id ~ '^schedule_firing_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  schedule_id text NOT NULL REFERENCES agent_world.agent_schedules(id) ON DELETE RESTRICT,
  scheduled_for timestamptz NOT NULL,
  task_id text NOT NULL UNIQUE REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  UNIQUE (schedule_id, scheduled_for)
);

CREATE INDEX agent_schedules_due_idx
  ON agent_world.agent_schedules (next_fire_at, id)
  WHERE is_enabled = true;
