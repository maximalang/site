CREATE TABLE agent_world.memory_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE CHECK (sequence > 0),
  id text PRIMARY KEY CHECK (
    id ~ '^event_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  event_type text NOT NULL CHECK (event_type IN ('MEMORY_PROPOSED', 'MEMORY_CURATED')),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  proposal_id text NOT NULL REFERENCES agent_world.memory_proposals(id) ON DELETE RESTRICT,
  decision_id text REFERENCES agent_world.memory_curation_decisions(id) ON DELETE RESTRICT,
  source_context_item_id text NOT NULL,
  materialized_context_item_id text,
  action text CHECK (action IN ('ACCEPT', 'MERGE', 'REJECT')),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  FOREIGN KEY (source_context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (materialized_context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT,
  UNIQUE (proposal_id, event_type),
  CHECK (
    (event_type = 'MEMORY_PROPOSED' AND decision_id IS NULL AND action IS NULL
      AND materialized_context_item_id IS NULL) OR
    (event_type = 'MEMORY_CURATED' AND decision_id IS NOT NULL AND action IS NOT NULL
      AND ((action = 'REJECT' AND materialized_context_item_id IS NULL)
        OR (action IN ('ACCEPT', 'MERGE') AND materialized_context_item_id IS NOT NULL)))
  )
);

CREATE INDEX memory_events_replay
  ON agent_world.memory_events (project_id, sequence, id);

CREATE TABLE agent_world.memory_projection_checkpoints (
  projection_name text PRIMARY KEY CHECK (
    char_length(projection_name) BETWEEN 1 AND 100
    AND projection_name ~ '^[a-z][a-z0-9._-]*$'
  ),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL
);

