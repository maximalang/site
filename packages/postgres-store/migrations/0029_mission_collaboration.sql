CREATE TABLE agent_world.mission_decompositions (
  id text PRIMARY KEY CHECK (
    id ~ '^mission_decomposition_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  mission_id text NOT NULL,
  project_id text NOT NULL,
  source_event_id text NOT NULL REFERENCES agent_world.world_events(id) ON DELETE RESTRICT,
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 1 AND 20000),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (mission_id, project_id)
    REFERENCES agent_world.missions(id, project_id) ON DELETE RESTRICT,
  UNIQUE (mission_id)
);

CREATE TABLE agent_world.mission_decomposition_tasks (
  decomposition_id text NOT NULL REFERENCES agent_world.mission_decompositions(id) ON DELETE CASCADE,
  task_key text NOT NULL CHECK (task_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  task_position integer NOT NULL CHECK (task_position BETWEEN 0 AND 99),
  assignee_agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  PRIMARY KEY (decomposition_id, task_key),
  UNIQUE (decomposition_id, task_position)
);

CREATE TABLE agent_world.structured_meetings (
  id text PRIMARY KEY CHECK (
    id ~ '^structured_meeting_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  mission_id text NOT NULL,
  project_id text NOT NULL,
  topic text NOT NULL CHECK (char_length(btrim(topic)) BETWEEN 1 AND 2000),
  synthesis text NOT NULL CHECK (char_length(btrim(synthesis)) BETWEEN 1 AND 20000),
  decision text NOT NULL CHECK (char_length(btrim(decision)) BETWEEN 1 AND 8000),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz NOT NULL,
  FOREIGN KEY (mission_id, project_id)
    REFERENCES agent_world.missions(id, project_id) ON DELETE RESTRICT
);

CREATE TABLE agent_world.structured_meeting_agents (
  meeting_id text NOT NULL REFERENCES agent_world.structured_meetings(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  position_index integer NOT NULL CHECK (position_index BETWEEN 0 AND 19),
  PRIMARY KEY (meeting_id, agent_id),
  UNIQUE (meeting_id, position_index)
);

CREATE TABLE agent_world.structured_meeting_sources (
  meeting_id text NOT NULL REFERENCES agent_world.structured_meetings(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES agent_world.world_events(id) ON DELETE RESTRICT,
  PRIMARY KEY (meeting_id, event_id)
);

CREATE TABLE agent_world.mission_collaboration_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE CHECK (sequence > 0),
  id text PRIMARY KEY CHECK (
    id ~ '^event_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  event_type text NOT NULL CHECK (event_type IN ('MISSION_DECOMPOSED', 'MEETING_DECIDED')),
  mission_id text NOT NULL REFERENCES agent_world.missions(id) ON DELETE RESTRICT,
  decomposition_id text REFERENCES agent_world.mission_decompositions(id) ON DELETE RESTRICT,
  meeting_id text REFERENCES agent_world.structured_meetings(id) ON DELETE RESTRICT,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  CHECK (
    (event_type = 'MISSION_DECOMPOSED' AND decomposition_id IS NOT NULL AND meeting_id IS NULL)
    OR (event_type = 'MEETING_DECIDED' AND decomposition_id IS NULL AND meeting_id IS NOT NULL)
  )
);

CREATE INDEX mission_collaboration_events_replay
  ON agent_world.mission_collaboration_events (mission_id, sequence, id);
