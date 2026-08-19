CREATE TABLE agent_world.rag_document_chunk_occurrences (
  document_id text NOT NULL,
  project_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 1000000),
  document_chunk_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (document_id, ordinal),
  FOREIGN KEY (document_id, project_id)
    REFERENCES agent_world.rag_documents(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (document_chunk_id, project_id)
    REFERENCES agent_world.rag_document_chunks(id, project_id) ON DELETE RESTRICT
);

INSERT INTO agent_world.rag_document_chunk_occurrences
  (document_id, project_id, ordinal, document_chunk_id, created_at)
SELECT document_id, project_id, ordinal, id, created_at
  FROM agent_world.rag_document_chunks
ON CONFLICT (document_id, ordinal) DO NOTHING;

CREATE INDEX rag_document_chunk_occurrences_chunk
  ON agent_world.rag_document_chunk_occurrences
  (document_chunk_id, document_id, ordinal);
