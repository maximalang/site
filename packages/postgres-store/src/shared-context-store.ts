import { createHash } from "node:crypto";
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
  contextItemId?: string;
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
    const contentHash = sha256(input.content);
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
          contentHash,
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
          [input.projectId, contentHash],
        );
        canonical = raced.rows[0];
      }
      if (!canonical) throw new SharedContextConflictError("DOCUMENT_ORDINAL_CONFLICT");
      if (input.embedding && input.embeddingModel) {
        await client.query(
          `INSERT INTO agent_world.rag_document_chunk_embeddings
             (document_chunk_id, project_id, embedding_model, embedding, created_at)
           VALUES ($1, $2, $3, $4::vector, $5)
           ON CONFLICT (document_chunk_id, embedding_model) DO UPDATE
             SET embedding = EXCLUDED.embedding,
                 created_at = EXCLUDED.created_at
           WHERE EXCLUDED.created_at > agent_world.rag_document_chunk_embeddings.created_at`,
          [
            canonical.id,
            input.projectId,
            input.embeddingModel,
            vectorLiteral(input.embedding),
            input.createdAt,
          ],
        );
      }
      const contextResult = await client.query<{ id: string }>(
        `WITH inserted AS (
           INSERT INTO agent_world.context_items
             (id, project_id, kind, temperature, content, content_sha256,
              estimated_tokens, importance, provenance_kind, document_chunk_id, created_at)
           VALUES ($1, $2, 'RAG_CHUNK', $3, $4, $5, $6, $7,
                   'DOCUMENT_CHUNK', $8, $9)
           ON CONFLICT DO NOTHING
           RETURNING id
         )
         SELECT id FROM inserted
         UNION ALL
         SELECT id FROM agent_world.context_items
          WHERE project_id = $2 AND kind = 'RAG_CHUNK' AND content_sha256 = $5
            AND provenance_kind = 'DOCUMENT_CHUNK' AND document_chunk_id = $8
            AND NOT EXISTS (SELECT 1 FROM inserted)
         LIMIT 1`,
        [
          input.contextItemId,
          input.projectId,
          input.temperature,
          input.content,
          contentHash,
          input.estimatedTokens,
          input.importance,
          canonical.id,
          input.createdAt,
        ],
      );
      let contextItemId = contextResult.rows[0]?.id;
      if (!contextItemId) {
        const racedContext = await client.query<{ id: string }>(
          `SELECT id
             FROM agent_world.context_items
            WHERE project_id = $1 AND kind = 'RAG_CHUNK' AND content_sha256 = $2
              AND provenance_kind = 'DOCUMENT_CHUNK' AND document_chunk_id = $3`,
          [input.projectId, contentHash, canonical.id],
        );
        contextItemId = racedContext.rows[0]?.id;
      }
      if (!contextItemId) throw new Error("Canonical RAG context item was not persisted");
      await client.query("COMMIT");
      return {
        outcome: canonical.inserted ? "CREATED" : "DEDUPLICATED",
        chunkId: canonical.id,
        contextItemId,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ingestDocumentWithChunks(value: unknown): Promise<{
    outcome: "CREATED" | "DEDUPLICATED";
    documentId: string;
    chunkIds: string[];
    contextItemIds: string[];
  }> {
    if (!value || typeof value !== "object" || !("document" in value) || !("chunks" in value)) {
      throw new TypeError("Atomic RAG write is invalid");
    }
    const document = RagDocumentIngestSchema.parse(value.document);
    if (!Array.isArray(value.chunks)) throw new TypeError("Atomic RAG chunks are invalid");
    const chunks = value.chunks.map((chunk) => RagDocumentChunkWriteSchema.parse(chunk));
    if (
      chunks.length < 1 ||
      chunks.length > 2_000 ||
      chunks.some(
        (chunk, ordinal) =>
          chunk.projectId !== document.projectId ||
          chunk.documentId !== document.id ||
          chunk.ordinal !== ordinal,
      )
    ) {
      throw new TypeError("Atomic RAG chunks must be contiguous and belong to the document");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const documentResult = await client.query<CanonicalRow>(
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
          document.id,
          document.projectId,
          document.title,
          document.contentHash,
          document.mimeType,
          document.byteSize,
          document.createdAt,
        ],
      );
      let canonicalDocument = documentResult.rows[0];
      if (!canonicalDocument) {
        const raced = await client.query<CanonicalRow>(
          `SELECT id, false AS inserted
             FROM agent_world.rag_documents
            WHERE project_id = $1 AND content_sha256 = $2`,
          [document.projectId, document.contentHash],
        );
        canonicalDocument = raced.rows[0];
      }
      if (!canonicalDocument) throw new Error("Canonical RAG document was not persisted");
      await client.query(
        `INSERT INTO agent_world.rag_document_sources
           (document_id, source_kind, source_ref, observed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, source_kind, source_ref) DO NOTHING`,
        [
          canonicalDocument.id,
          document.source.kind,
          document.source.ref,
          document.source.observedAt,
        ],
      );

      const chunkIds: string[] = [];
      const contextItemIds: string[] = [];
      let created = canonicalDocument.inserted;
      for (const chunk of chunks) {
        const contentHash = sha256(chunk.content);
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
            chunk.id,
            canonicalDocument.id,
            chunk.projectId,
            chunk.ordinal,
            chunk.content,
            contentHash,
            chunk.estimatedTokens,
            chunk.embeddingModel ?? null,
            chunk.embedding ? vectorLiteral(chunk.embedding) : null,
            chunk.createdAt,
          ],
        );
        let canonicalChunk = result.rows[0];
        if (!canonicalChunk) {
          const raced = await client.query<CanonicalRow>(
            `SELECT id, false AS inserted
               FROM agent_world.rag_document_chunks
              WHERE project_id = $1 AND content_sha256 = $2`,
            [chunk.projectId, contentHash],
          );
          canonicalChunk = raced.rows[0];
        }
        if (!canonicalChunk) throw new SharedContextConflictError("DOCUMENT_ORDINAL_CONFLICT");
        if (chunk.embedding && chunk.embeddingModel) {
          await client.query(
            `INSERT INTO agent_world.rag_document_chunk_embeddings
               (document_chunk_id, project_id, embedding_model, embedding, created_at)
             VALUES ($1, $2, $3, $4::vector, $5)
             ON CONFLICT (document_chunk_id, embedding_model) DO UPDATE
               SET embedding = EXCLUDED.embedding,
                   created_at = EXCLUDED.created_at
             WHERE EXCLUDED.created_at > agent_world.rag_document_chunk_embeddings.created_at`,
            [
              canonicalChunk.id,
              chunk.projectId,
              chunk.embeddingModel,
              vectorLiteral(chunk.embedding),
              chunk.createdAt,
            ],
          );
        }
        created ||= canonicalChunk.inserted;
        const contextResult = await client.query<{ id: string }>(
          `WITH inserted AS (
             INSERT INTO agent_world.context_items
               (id, project_id, kind, temperature, content, content_sha256,
                estimated_tokens, importance, provenance_kind, document_chunk_id, created_at)
             VALUES ($1, $2, 'RAG_CHUNK', $3, $4, $5, $6, $7,
                     'DOCUMENT_CHUNK', $8, $9)
             ON CONFLICT DO NOTHING
             RETURNING id
           )
           SELECT id FROM inserted
           UNION ALL
           SELECT id FROM agent_world.context_items
            WHERE project_id = $2 AND kind = 'RAG_CHUNK' AND content_sha256 = $5
              AND provenance_kind = 'DOCUMENT_CHUNK' AND document_chunk_id = $8
              AND NOT EXISTS (SELECT 1 FROM inserted)
           LIMIT 1`,
          [
            chunk.contextItemId,
            chunk.projectId,
            chunk.temperature,
            chunk.content,
            contentHash,
            chunk.estimatedTokens,
            chunk.importance,
            canonicalChunk.id,
            chunk.createdAt,
          ],
        );
        let contextItemId = contextResult.rows[0]?.id;
        if (!contextItemId) {
          const racedContext = await client.query<{ id: string }>(
            `SELECT id
               FROM agent_world.context_items
              WHERE project_id = $1 AND kind = 'RAG_CHUNK' AND content_sha256 = $2
                AND provenance_kind = 'DOCUMENT_CHUNK' AND document_chunk_id = $3`,
            [chunk.projectId, contentHash, canonicalChunk.id],
          );
          contextItemId = racedContext.rows[0]?.id;
        }
        if (!contextItemId) throw new Error("Canonical RAG context item was not persisted");
        chunkIds.push(canonicalChunk.id);
        contextItemIds.push(contextItemId);
      }
      await client.query("COMMIT");
      return {
        outcome: created ? "CREATED" : "DEDUPLICATED",
        documentId: canonicalDocument.id,
        chunkIds,
        contextItemIds,
      };
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
        `SELECT chunk.id, chunk.document_id, chunk.project_id, chunk.ordinal, chunk.content,
                chunk.content_sha256, chunk.estimated_tokens, projection.embedding_model,
                projection.embedding <=> $2::vector AS distance, chunk.created_at
           FROM agent_world.rag_document_chunks AS chunk
           JOIN agent_world.rag_document_chunk_embeddings AS projection
             ON projection.document_chunk_id = chunk.id
            AND projection.project_id = chunk.project_id
          WHERE projection.project_id = $1 AND projection.embedding_model = $5
            AND ($4::double precision IS NULL OR (projection.embedding <=> $2::vector) <= $4)
          ORDER BY projection.embedding <=> $2::vector, chunk.id
          LIMIT $3`,
        [
          input.projectId,
          vectorLiteral(input.embedding),
          input.maxItems,
          input.maxDistance ?? null,
          input.embeddingModel,
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
