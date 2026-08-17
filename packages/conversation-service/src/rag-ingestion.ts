import { createHash, randomUUID } from "node:crypto";
import {
  type RagDocumentChunkWrite,
  type RagDocumentIngest,
  type RagIngestionReceipt,
  RagIngestionReceiptSchema,
  type RagIngestionRequest,
  RagIngestionRequestSchema,
} from "@agent-world/domain";

export type RagChunkingOptions = {
  maxCharacters: number;
  overlapCharacters: number;
};

export type RagEmbeddingResult = {
  model: string;
  vectors: number[][];
};

export interface RagEmbeddingGateway {
  embed(input: {
    modelRouteId: string;
    texts: string[];
    timeoutMs: number;
  }): Promise<RagEmbeddingResult>;
}

export type AtomicRagWrite = {
  document: RagDocumentIngest;
  chunks: RagDocumentChunkWrite[];
};

export interface AtomicRagStore {
  ingestDocumentWithChunks(input: AtomicRagWrite): Promise<{
    outcome: "CREATED" | "DEDUPLICATED";
    documentId: string;
    chunkIds: string[];
    contextItemIds: string[];
  }>;
}

type RagIngestionServiceOptions = {
  embeddingGateway: RagEmbeddingGateway;
  store: AtomicRagStore;
  embeddingModelRouteId: string;
  chunking?: RagChunkingOptions;
  now?: () => Date;
  nextId?: (prefix: "document" | "document_chunk" | "context_item") => string;
};

const DEFAULT_CHUNKING = { maxCharacters: 4_000, overlapCharacters: 400 } as const;

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function validateChunking(options: RagChunkingOptions): RagChunkingOptions {
  if (
    !Number.isInteger(options.maxCharacters) ||
    options.maxCharacters < 32 ||
    options.maxCharacters > 20_000 ||
    !Number.isInteger(options.overlapCharacters) ||
    options.overlapCharacters < 0 ||
    options.overlapCharacters >= options.maxCharacters / 2
  ) {
    throw new TypeError("RAG chunking options are invalid");
  }
  return options;
}

export function splitRagText(
  value: string,
  options: RagChunkingOptions = DEFAULT_CHUNKING,
): string[] {
  const text = normalizeText(value);
  const { maxCharacters, overlapCharacters } = validateChunking(options);
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxCharacters);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const whitespace = text.lastIndexOf(" ", end);
      const candidate = paragraph >= start + 32 ? paragraph : whitespace;
      if (candidate >= start + 32) end = candidate;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    const next = Math.max(start + 1, end - overlapCharacters);
    const boundary = text.indexOf(" ", next);
    start = boundary >= 0 && boundary < end ? boundary + 1 : next;
    if (chunks.length >= 2_000) throw new Error("RAG document exceeds the chunk limit");
  }
  return chunks;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export class RagIngestionService {
  private readonly chunking: RagChunkingOptions;
  private readonly now: () => Date;
  private readonly nextId: NonNullable<RagIngestionServiceOptions["nextId"]>;

  constructor(private readonly options: RagIngestionServiceOptions) {
    this.chunking = validateChunking(options.chunking ?? DEFAULT_CHUNKING);
    this.now = options.now ?? (() => new Date());
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${randomUUID()}`);
  }

  async ingest(value: unknown): Promise<RagIngestionReceipt> {
    const input: RagIngestionRequest = RagIngestionRequestSchema.parse(value);
    const content = normalizeText(input.content);
    const texts = splitRagText(content, this.chunking);
    if (texts.length === 0) throw new Error("RAG document contains no indexable text");
    const vectors: number[][] = [];
    let embeddingModel: string | undefined;
    for (let start = 0; start < texts.length; start += 64) {
      const batch = texts.slice(start, start + 64);
      const embedded = await this.options.embeddingGateway.embed({
        modelRouteId: this.options.embeddingModelRouteId,
        texts: batch,
        timeoutMs: 120_000,
      });
      if (embedded.vectors.length !== batch.length) {
        throw new Error("Embedding result count does not match RAG chunks");
      }
      if (embeddingModel !== undefined && embedded.model !== embeddingModel) {
        throw new Error("Embedding model changed during RAG ingestion");
      }
      embeddingModel = embedded.model;
      vectors.push(...embedded.vectors);
    }
    if (!embeddingModel) throw new Error("Embedding gateway returned no model identity");
    const createdAt = this.now().toISOString();
    const documentId = this.nextId("document");
    const document: RagDocumentIngest = {
      schemaVersion: 1,
      id: documentId as RagDocumentIngest["id"],
      projectId: input.projectId,
      title: input.title,
      contentHash: sha256(content),
      mimeType: input.mimeType,
      byteSize: Buffer.byteLength(content, "utf8"),
      source: input.source,
      createdAt,
    };
    const chunks: RagDocumentChunkWrite[] = texts.map((text, ordinal) => ({
      schemaVersion: 1,
      id: this.nextId("document_chunk") as RagDocumentChunkWrite["id"],
      contextItemId: this.nextId("context_item") as RagDocumentChunkWrite["contextItemId"],
      documentId: document.id,
      projectId: input.projectId,
      ordinal,
      content: text,
      contentHash: sha256(text),
      estimatedTokens: Math.max(1, Math.ceil(text.length / 4)),
      temperature: "COLD",
      importance: 0.5,
      embeddingModel,
      embedding: vectors[ordinal],
      createdAt,
    }));
    const receipt = await this.options.store.ingestDocumentWithChunks({ document, chunks });
    return RagIngestionReceiptSchema.parse({
      schemaVersion: 1,
      ...receipt,
      chunkCount: receipt.chunkIds.length,
      embeddingModel,
    });
  }
}
