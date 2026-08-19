ALTER TABLE agent_world.rag_document_chunks
  ADD CONSTRAINT rag_document_chunks_id_project_key UNIQUE (id, project_id);

CREATE TABLE agent_world.rag_document_chunk_embeddings (
  document_chunk_id text NOT NULL,
  project_id text NOT NULL,
  embedding_model text NOT NULL CHECK (
    char_length(btrim(embedding_model)) BETWEEN 1 AND 200
  ),
  embedding vector(1536) NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (document_chunk_id, embedding_model),
  FOREIGN KEY (document_chunk_id, project_id)
    REFERENCES agent_world.rag_document_chunks(id, project_id) ON DELETE RESTRICT,
  CHECK (vector_norm(embedding) > 0)
);

INSERT INTO agent_world.rag_document_chunk_embeddings
  (document_chunk_id, project_id, embedding_model, embedding, created_at)
SELECT id, project_id, embedding_model, embedding, created_at
  FROM agent_world.rag_document_chunks
 WHERE embedding_model IS NOT NULL AND embedding IS NOT NULL
ON CONFLICT (document_chunk_id, embedding_model) DO NOTHING;

CREATE INDEX rag_document_chunk_embeddings_project_model
  ON agent_world.rag_document_chunk_embeddings
  (project_id, embedding_model, document_chunk_id);

CREATE INDEX rag_document_chunk_embeddings_hnsw
  ON agent_world.rag_document_chunk_embeddings
  USING hnsw (embedding vector_cosine_ops);
