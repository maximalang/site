import {
  type RagDocumentChunkWrite,
  RagDocumentChunkWriteSchema,
  type RagDocumentIngest,
  RagDocumentIngestSchema,
  type RagRetrievalRequest,
  RagRetrievalRequestSchema,
  type RagRetrievalResult,
  RagRetrievalResultSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type CanonicalRow = QueryResultRow & { id: string; inserted: boolean };
type RetrievalRow = QueryResultRow & {
  id: string;
  document_id: string;
  project_id: string;
  ordinal: number;
  content: string;
  content_sha256: string;
  estimated_tokens: number;
  embedding_model: string;
  distance: number;
  created_at: Date | string;
};

export type SharedContextWriteReceipt = {
  outcome: "CREATED" | "DEDUPLICATED";
  documentId?: string;
  chunkId?: string;
};

export class SharedContextConflictError extends Error {
  constructor(readonly code: "DOCUMENT_ORDINAL_CONFLICT") {
    super(code);
    this.name = "SharedContextConflictError";
  }
}

function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

export class PostgresSharedContextStore {
  constructor(private readonly pool: TransactionPool) {}

  async ingestDocument(value: unknown): Promise<SharedContextWriteReceipt> {
    const input: RagDocumentIngest = RagDocumentIngestSchema.parse(value);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CanonicalRow>(
        `WITH inserted AS (
           INSERT INTO agent_world.rag_documents
             (id, project_id, title, content_sha256, mime_type, byte_size, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (project_id, content_sha256) DO NOTHING
           RETURNING id
         )
         SELECT id, true AS inserted FROM inserted
         UNION ALL
         SELECT id, false AS inserted
           FROM agent_world.rag_documents
          WHERE project_id = $2 AND content_sha256 = $4
            AND NOT EXISTS (SELECT 1 FROM inserted)
         LIMIT 1`,
        [
          input.id,
          input.projectId,
          input.title,
          input.contentHash,
          input.mimeType,
          input.byteSize,
          input.createdAt,
        ],
      );
      let canonical = result.rows[0];
      if (!canonical) {
        const raced = await client.query<CanonicalRow>(
          `SELECT id, false AS inserted
             FROM agent_world.rag_documents
            WHERE project_id = $1 AND content_sha256 = $2`,
          [input.projectId, input.contentHash],
        );
        canonical = raced.rows[0];
      }
      if (!canonical) throw new Error("Canonical RAG document was not persisted");
      await client.query(
        `INSERT INTO agent_world.rag_document_sources
           (document_id, source_kind, source_ref, observed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, source_kind, source_ref) DO NOTHING`,
        [canonical.id, input.source.kind, input.source.ref, input.source.observedAt],
      );
      await client.query("COMMIT");
      return {
        outcome: canonical.inserted ? "CREATED" : "DEDUPLICATED",
        documentId: canonical.id,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async writeChunk(value: unknown): Promise<SharedContextWriteReceipt> {
    const input: RagDocumentChunkWrite = RagDocumentChunkWriteSchema.parse(value);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CanonicalRow>(
        `WITH inserted AS (
           INSERT INTO agent_world.rag_document_chunks
             (id, document_id, project_id, ordinal, content, content_sha256,
              estimated_tokens, embedding_model, embedding, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
           ON CONFLICT DO NOTHING
           RETURNING id
         )
         SELECT id, true AS inserted FROM inserted
         UNION ALL
         SELECT id, false AS inserted
           FROM agent_world.rag_document_chunks
          WHERE project_id = $3 AND content_sha256 = $6
            AND NOT EXISTS (SELECT 1 FROM inserted)
         LIMIT 1`,
        [
          input.id,
          input.documentId,
          input.projectId,
          input.ordinal,
          input.content,
          input.contentHash,
          input.estimatedTokens,
          input.embeddingModel ?? null,
          input.embedding ? vectorLiteral(input.embedding) : null,
          input.createdAt,
        ],
      );
      let canonical = result.rows[0];
      if (!canonical) {
        const raced = await client.query<CanonicalRow>(
          `SELECT id, false AS inserted
             FROM agent_world.rag_document_chunks
            WHERE project_id = $1 AND content_sha256 = $2`,
          [input.projectId, input.contentHash],
        );
        canonical = raced.rows[0];
      }
      if (!canonical) throw new SharedContextConflictError("DOCUMENT_ORDINAL_CONFLICT");
      await client.query("COMMIT");
      return { outcome: canonical.inserted ? "CREATED" : "DEDUPLICATED", chunkId: canonical.id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async retrieve(value: unknown): Promise<RagRetrievalResult[]> {
    const input: RagRetrievalRequest = RagRetrievalRequestSchema.parse(value);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL hnsw.iterative_scan = strict_order");
      const result = await client.query<RetrievalRow>(
        `SELECT id, document_id, project_id, ordinal, content, content_sha256,
                estimated_tokens, embedding_model, embedding <=> $2::vector AS distance,
                created_at
           FROM agent_world.rag_document_chunks
          WHERE project_id = $1 AND embedding IS NOT NULL
            AND ($4::double precision IS NULL OR (embedding <=> $2::vector) <= $4)
          ORDER BY embedding <=> $2::vector, id
          LIMIT $3`,
        [
          input.projectId,
          vectorLiteral(input.embedding),
          input.maxItems,
          input.maxDistance ?? null,
        ],
      );
      await client.query("COMMIT");
      return result.rows.map((row) =>
        RagRetrievalResultSchema.parse({
          chunkId: row.id,
          documentId: row.document_id,
          projectId: row.project_id,
          ordinal: row.ordinal,
          content: row.content,
          contentHash: row.content_sha256,
          estimatedTokens: row.estimated_tokens,
          embeddingModel: row.embedding_model,
          distance: row.distance,
          createdAt: TimestampSchema.parse(
            row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
          ),
        }),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
