CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE agent_world.rag_documents (
  id text PRIMARY KEY CHECK (
    id ~ '^document_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 500),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL CHECK (
    char_length(mime_type) BETWEEN 3 AND 200 AND mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'
  ),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 1000000000),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, content_sha256),
  UNIQUE (id, project_id)
);

CREATE TABLE agent_world.rag_document_sources (
  document_id text NOT NULL REFERENCES agent_world.rag_documents(id) ON DELETE RESTRICT,
  source_kind text NOT NULL CHECK (source_kind IN ('PROJECT_FILE', 'UPLOAD', 'URL', 'ARTIFACT')),
  source_ref text NOT NULL CHECK (
    char_length(source_ref) BETWEEN 1 AND 2048
    AND source_ref !~ '[[:cntrl:]]'
    AND source_ref !~ '^[a-z][a-z0-9+.-]*://[^/[:space:]]+@'
  ),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (document_id, source_kind, source_ref)
);

CREATE TABLE agent_world.rag_document_chunks (
  id text PRIMARY KEY CHECK (
    id ~ '^document_chunk_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  document_id text NOT NULL,
  project_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 1000000),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 200000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  estimated_tokens integer NOT NULL CHECK (estimated_tokens BETWEEN 1 AND 100000),
  embedding_model text CHECK (
    embedding_model IS NULL OR char_length(btrim(embedding_model)) BETWEEN 1 AND 200
  ),
  embedding vector(1536),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (document_id, project_id)
    REFERENCES agent_world.rag_documents(id, project_id) ON DELETE RESTRICT,
  UNIQUE (document_id, ordinal),
  UNIQUE (project_id, content_sha256),
  CHECK ((embedding IS NULL) = (embedding_model IS NULL)),
  CHECK (embedding IS NULL OR vector_norm(embedding) > 0)
);

CREATE INDEX rag_document_chunks_project
  ON agent_world.rag_document_chunks (project_id, created_at DESC, id);

CREATE INDEX rag_document_chunks_embedding_hnsw
  ON agent_world.rag_document_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE agent_world.artifacts (
  id text PRIMARY KEY CHECK (
    id ~ '^artifact_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  run_id text REFERENCES agent_world.runs(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  media_type text NOT NULL CHECK (
    char_length(media_type) BETWEEN 3 AND 200 AND media_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'
  ),
  storage_ref text NOT NULL CHECK (
    char_length(storage_ref) BETWEEN 1 AND 2048 AND storage_ref !~ '[[:cntrl:]]'
  ),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 0 AND 10000000000),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, content_sha256, storage_ref)
);

CREATE TABLE agent_world.context_items (
  id text PRIMARY KEY CHECK (
    id ~ '^context_item_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  project_id text NOT NULL REFERENCES agent_world.projects(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN (
    'PROJECT_STATE', 'DECISION', 'FINDING', 'TASK', 'ARTIFACT',
    'AGENT_RESULT', 'SKILL', 'ACTION_HISTORY', 'MEMORY', 'RAG_CHUNK'
  )),
  temperature text NOT NULL CHECK (temperature IN ('HOT', 'WARM', 'COLD')),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 200000),
  summary text CHECK (summary IS NULL OR char_length(btrim(summary)) BETWEEN 1 AND 20000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  estimated_tokens integer NOT NULL CHECK (estimated_tokens BETWEEN 1 AND 100000),
  importance double precision NOT NULL CHECK (importance BETWEEN 0 AND 1),
  provenance_kind text NOT NULL CHECK (provenance_kind IN (
    'DOMAIN_EVENT', 'MESSAGE', 'RUN', 'ARTIFACT', 'DOCUMENT_CHUNK'
  )),
  event_id text REFERENCES agent_world.world_events(id) ON DELETE RESTRICT,
  message_id text REFERENCES agent_world.conversation_messages(id) ON DELETE RESTRICT,
  run_id text REFERENCES agent_world.runs(id) ON DELETE RESTRICT,
  artifact_id text REFERENCES agent_world.artifacts(id) ON DELETE RESTRICT,
  document_chunk_id text REFERENCES agent_world.rag_document_chunks(id) ON DELETE RESTRICT,
  agent_id text REFERENCES agent_world.agents(id) ON DELETE RESTRICT,
  task_id text REFERENCES agent_world.tasks(id) ON DELETE RESTRICT,
  skill_id text REFERENCES agent_world.skills(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  valid_until timestamptz,
  CHECK (valid_until IS NULL OR valid_until > created_at),
  CHECK (num_nonnulls(event_id, message_id, run_id, artifact_id, document_chunk_id) = 1),
  CHECK (
    (provenance_kind = 'DOMAIN_EVENT' AND event_id IS NOT NULL) OR
    (provenance_kind = 'MESSAGE' AND message_id IS NOT NULL) OR
    (provenance_kind = 'RUN' AND run_id IS NOT NULL) OR
    (provenance_kind = 'ARTIFACT' AND artifact_id IS NOT NULL) OR
    (provenance_kind = 'DOCUMENT_CHUNK' AND document_chunk_id IS NOT NULL)
  ),
  UNIQUE NULLS NOT DISTINCT (
    project_id, kind, content_sha256, provenance_kind,
    event_id, message_id, run_id, artifact_id, document_chunk_id
  )
);

CREATE INDEX context_items_project_active
  ON agent_world.context_items (project_id, temperature, importance DESC, created_at DESC, id);
