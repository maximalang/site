ALTER TABLE agent_world.context_items
  ADD CONSTRAINT context_items_id_project_unique UNIQUE (id, project_id);

CREATE TABLE agent_world.memory_proposals (
  id text PRIMARY KEY CHECK (
    id ~ '^memory_proposal_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  source_context_item_id text NOT NULL,
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 20000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  estimated_tokens integer NOT NULL CHECK (estimated_tokens BETWEEN 1 AND 10000),
  importance double precision NOT NULL CHECK (importance BETWEEN 0 AND 1),
  status text NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'MERGED', 'REJECTED')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  FOREIGN KEY (source_context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT,
  UNIQUE (id, project_id),
  UNIQUE (project_id, source_context_item_id, content_sha256),
  CHECK ((status = 'PENDING') = (decided_at IS NULL))
);

CREATE INDEX memory_proposals_inbox
  ON agent_world.memory_proposals (project_id, created_at DESC, id)
  WHERE status = 'PENDING';

CREATE TABLE agent_world.memory_curation_decisions (
  id text PRIMARY KEY CHECK (
    id ~ '^memory_decision_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  proposal_id text NOT NULL UNIQUE,
  project_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('ACCEPT', 'MERGE', 'REJECT')),
  target_context_item_id text,
  materialized_context_item_id text,
  idempotency_key text NOT NULL UNIQUE CHECK (
    char_length(idempotency_key) BETWEEN 3 AND 200
  ),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  decided_at timestamptz NOT NULL,
  FOREIGN KEY (proposal_id, project_id)
    REFERENCES agent_world.memory_proposals(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (materialized_context_item_id, project_id)
    REFERENCES agent_world.context_items(id, project_id) ON DELETE RESTRICT,
  CHECK (
    (action = 'ACCEPT' AND target_context_item_id IS NULL
      AND materialized_context_item_id IS NOT NULL) OR
    (action = 'MERGE' AND target_context_item_id IS NOT NULL
      AND materialized_context_item_id = target_context_item_id) OR
    (action = 'REJECT' AND target_context_item_id IS NULL
      AND materialized_context_item_id IS NULL)
  )
);

CREATE INDEX memory_curation_timeline
  ON agent_world.memory_curation_decisions (project_id, decided_at DESC, id);

