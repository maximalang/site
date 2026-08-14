import { createHash } from "node:crypto";
import {
  type AccountId,
  AccountIdSchema,
  type NativeChatPullRequest,
  NativeChatPullRequestSchema,
  type NativeChatPullResponse,
  NativeChatPullResponseSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type ScopeRow = QueryResultRow & {
  run_id: string;
  account_id: string;
  dispatch_state: string;
  last_sequence: number;
  run_status: string;
  run_created_at: Date | string;
  task_id: string;
  task_title: string;
  task_description: string | null;
  task_created_at: Date | string;
  project_id: string;
  project_name: string;
  project_slug: string;
  project_created_at: Date | string;
  agent_id: string;
  agent_slug: string;
  agent_display_name: string;
  agent_role: string;
  agent_instructions: string;
  agent_created_at: Date | string;
  route_id: string;
};

type SkillRow = QueryResultRow & {
  id: string;
  slug: string;
  display_name: string;
  version: string;
  description: string;
  source_kind: string;
  source_ref: string;
  integrity_sha256: string;
  created_at: Date | string;
};

type EventRow = QueryResultRow & {
  sequence: number;
  event_type: string;
  payload: unknown;
  event_sha256: string;
  occurred_at: Date | string;
};

type ContextRow = QueryResultRow & {
  id: string;
  kind: string;
  temperature: string;
  content: string;
  summary: string | null;
  importance: number;
  created_at: Date | string;
};

type RagRow = QueryResultRow & {
  id: string;
  document_id: string;
  ordinal: number;
  content: string;
  title: string;
  created_at: Date | string;
};

type ArtifactRow = QueryResultRow & {
  id: string;
  run_id: string | null;
  label: string;
  content_sha256: string;
  media_type: string;
  storage_ref: string;
  byte_size: string | number;
  created_at: Date | string;
};

type ResourceKind = NativeChatPullRequest["resources"][number];
type Candidate = Omit<NativeChatPullResponse["items"][number], "contentSha256" | "estimatedTokens">;

export type NativeChatResourceReaderErrorCode =
  | "RUN_NOT_FOUND"
  | "ACCOUNT_MISMATCH"
  | "RUN_NOT_ATTACHED"
  | "RUN_TERMINAL";

export class NativeChatResourceReaderError extends Error {
  constructor(readonly code: NativeChatResourceReaderErrorCode) {
    super(code);
    this.name = "NativeChatResourceReaderError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp(value: Date | string): string {
  return TimestampSchema.parse(value instanceof Date ? value.toISOString() : value);
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function estimatedTokens(content: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 4));
}

function provenance(entityType: string, entityId: string, recordedAt: Date | string) {
  return {
    source: "CANONICAL_POSTGRES" as const,
    entityType,
    entityId,
    recordedAt: timestamp(recordedAt),
  };
}

export class PostgresNativeChatResourceReader {
  private readonly pullId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly pool: TransactionPool,
    options: { pullId?: () => string; now?: () => Date } = {},
  ) {
    this.pullId =
      options.pullId ??
      (() => {
        throw new Error("A production resource pull identity generator is required");
      });
    this.now = options.now ?? (() => new Date());
  }

  async pull(accountIdValue: unknown, requestValue: unknown): Promise<NativeChatPullResponse> {
    const accountId: AccountId = AccountIdSchema.parse(accountIdValue);
    const request = NativeChatPullRequestSchema.parse(requestValue);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const scopeResult = await client.query<ScopeRow>(
        `SELECT d.run_id, d.account_id, d.state AS dispatch_state, d.last_sequence,
                r.status AS run_status, r.created_at AS run_created_at,
                t.id AS task_id, t.title AS task_title,
                t.description AS task_description, t.created_at AS task_created_at,
                p.id AS project_id, p.name AS project_name, p.slug AS project_slug,
                p.created_at AS project_created_at, a.id AS agent_id, a.slug AS agent_slug,
                a.display_name AS agent_display_name, a.role AS agent_role,
                a.instructions AS agent_instructions, a.created_at AS agent_created_at,
                d.route_id
           FROM agent_world.native_chat_dispatches d
           JOIN agent_world.runs r ON r.id = d.run_id
           JOIN agent_world.tasks t ON t.id = d.task_id
           JOIN agent_world.projects p ON p.id = t.project_id
           JOIN agent_world.agents a ON a.id = d.agent_id
          WHERE d.run_id = $1
          FOR SHARE OF d, r, t, p, a`,
        [request.runId],
      );
      const scope = scopeResult.rows[0];
      if (!scope) throw new NativeChatResourceReaderError("RUN_NOT_FOUND");
      if (scope.account_id !== accountId)
        throw new NativeChatResourceReaderError("ACCOUNT_MISMATCH");
      if (scope.dispatch_state !== "ATTACHED" || scope.last_sequence < 1)
        throw new NativeChatResourceReaderError("RUN_NOT_ATTACHED");
      if (scope.run_status !== "RUNNING") throw new NativeChatResourceReaderError("RUN_TERMINAL");

      const candidates = await this.candidates(client, scope, request);
      const items: NativeChatPullResponse["items"] = [];
      const omissions: NativeChatPullResponse["omissions"] = [];
      let tokens = 0;
      const requested = new Set<ResourceKind>(request.resources);
      const represented = new Set<ResourceKind>();
      for (const candidate of candidates) {
        represented.add(candidate.resource);
        const itemTokens = estimatedTokens(candidate.content);
        if (items.length >= request.maxItems) {
          if (!omissions.some((item) => item.resource === candidate.resource))
            omissions.push({ resource: candidate.resource, reason: "ITEM_LIMIT" });
          continue;
        }
        if (tokens + itemTokens > request.maxTokens) {
          if (!omissions.some((item) => item.resource === candidate.resource))
            omissions.push({ resource: candidate.resource, reason: "TOKEN_BUDGET" });
          continue;
        }
        items.push({
          ...candidate,
          contentSha256: sha256(candidate.content),
          estimatedTokens: itemTokens,
        });
        tokens += itemTokens;
      }
      for (const resource of requested) {
        if (represented.has(resource)) continue;
        omissions.push({
          resource,
          reason: "NO_MATCH",
        });
      }

      const pulledAt = timestamp(this.now());
      const pullId = this.pullId();
      const response = NativeChatPullResponseSchema.parse({
        schemaVersion: 1,
        pullId,
        runId: request.runId,
        items,
        omissions,
        estimatedTokens: tokens,
        maxTokens: request.maxTokens,
        pulledAt,
      });
      await client.query(
        `INSERT INTO agent_world.native_chat_resource_pulls
           (id, run_id, account_id, requested_resources, query_sha256,
            max_items, max_tokens, returned_items, estimated_tokens,
            response_sha256, pulled_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)`,
        [
          response.pullId,
          response.runId,
          accountId,
          JSON.stringify(request.resources),
          request.query ? sha256(request.query) : null,
          request.maxItems,
          request.maxTokens,
          response.items.length,
          response.estimatedTokens,
          sha256(JSON.stringify(response)),
          response.pulledAt,
        ],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async candidates(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    scope: ScopeRow,
    request: NativeChatPullRequest,
  ): Promise<Candidate[]> {
    const result: Candidate[] = [];
    const resources = new Set(request.resources);
    if (resources.has("TASK")) {
      result.push({
        resource: "TASK",
        content: serialize({
          task: { id: scope.task_id, title: scope.task_title, description: scope.task_description },
          run: { id: scope.run_id, routeId: scope.route_id },
          agent: {
            id: scope.agent_id,
            slug: scope.agent_slug,
            displayName: scope.agent_display_name,
            role: scope.agent_role,
            instructions: scope.agent_instructions,
          },
        }),
        provenance: [
          provenance("TASK", scope.task_id, scope.task_created_at),
          provenance("AGENT", scope.agent_id, scope.agent_created_at),
          provenance("RUN", scope.run_id, scope.run_created_at),
        ],
      });
    }
    if (resources.has("PROJECT_STATE")) {
      result.push({
        resource: "PROJECT_STATE",
        content: serialize({
          project: { id: scope.project_id, slug: scope.project_slug, name: scope.project_name },
        }),
        provenance: [provenance("PROJECT", scope.project_id, scope.project_created_at)],
      });
    }
    if (resources.has("SKILLS")) {
      const skills = await client.query<SkillRow>(
        `SELECT s.id, s.slug, s.display_name, s.version, s.description,
                s.source_kind, s.source_ref, s.integrity_sha256, s.created_at
           FROM agent_world.agent_skills assignment
           JOIN agent_world.skills s ON s.id = assignment.skill_id
          WHERE assignment.agent_id = $1 AND assignment.is_enabled AND s.is_enabled
            AND ($2::text IS NULL OR s.slug ILIKE '%' || $2 || '%'
                 OR s.display_name ILIKE '%' || $2 || '%'
                 OR s.description ILIKE '%' || $2 || '%')
          ORDER BY assignment.priority DESC, s.id
          LIMIT 101`,
        [scope.agent_id, request.query ?? null],
      );
      for (const skill of skills.rows) {
        result.push({
          resource: "SKILLS",
          content: serialize({
            id: skill.id,
            slug: skill.slug,
            displayName: skill.display_name,
            version: skill.version,
            description: skill.description,
            sourceKind: skill.source_kind,
            sourceRef: skill.source_ref,
            integritySha256: skill.integrity_sha256,
          }),
          provenance: [provenance("SKILL", skill.id, skill.created_at)],
        });
      }
    }
    if (resources.has("ACTION_HISTORY")) {
      const events = await client.query<EventRow>(
        `SELECT sequence, event_type, payload, event_sha256, occurred_at
           FROM agent_world.native_chat_control_events
          WHERE run_id = $1
            AND ($2::text IS NULL OR event_type ILIKE '%' || $2 || '%'
                 OR payload::text ILIKE '%' || $2 || '%')
          ORDER BY sequence DESC
          LIMIT 101`,
        [scope.run_id, request.query ?? null],
      );
      for (const event of events.rows.reverse()) {
        result.push({
          resource: "ACTION_HISTORY",
          content: serialize({
            sequence: event.sequence,
            eventType: event.event_type,
            payload: event.payload,
            eventSha256: event.event_sha256,
          }),
          provenance: [
            provenance(
              "NATIVE_CHAT_CONTROL_EVENT",
              `${scope.run_id}:${event.sequence}`,
              event.occurred_at,
            ),
          ],
        });
      }
    }
    if (resources.has("MEMORY")) {
      const memories = await client.query<ContextRow>(
        `SELECT id, kind, temperature, content, summary, importance, created_at
           FROM agent_world.context_items
          WHERE project_id = $1 AND kind = 'MEMORY'
            AND (valid_until IS NULL OR valid_until > now())
            AND ($2::text IS NULL OR content ILIKE '%' || $2 || '%'
                 OR summary ILIKE '%' || $2 || '%')
          ORDER BY importance DESC, created_at DESC, id
          LIMIT 101`,
        [scope.project_id, request.query ?? null],
      );
      for (const memory of memories.rows) {
        result.push({
          resource: "MEMORY",
          content: serialize({
            content: memory.content,
            summary: memory.summary,
            temperature: memory.temperature,
            importance: memory.importance,
          }),
          provenance: [provenance("CONTEXT_ITEM", memory.id, memory.created_at)],
        });
      }
    }
    if (resources.has("RAG")) {
      const chunks = await client.query<RagRow>(
        `SELECT c.id, c.document_id, c.ordinal, c.content, d.title, c.created_at
           FROM agent_world.rag_document_chunks c
           JOIN agent_world.rag_documents d ON d.id = c.document_id
          WHERE c.project_id = $1
            AND ($2::text IS NULL OR c.content ILIKE '%' || $2 || '%'
                 OR d.title ILIKE '%' || $2 || '%')
          ORDER BY c.created_at DESC, c.id
          LIMIT 101`,
        [scope.project_id, request.query ?? null],
      );
      for (const chunk of chunks.rows) {
        result.push({
          resource: "RAG",
          content: serialize({
            documentId: chunk.document_id,
            title: chunk.title,
            ordinal: chunk.ordinal,
            content: chunk.content,
          }),
          provenance: [provenance("DOCUMENT_CHUNK", chunk.id, chunk.created_at)],
        });
      }
    }
    if (resources.has("ARTIFACTS")) {
      const artifacts = await client.query<ArtifactRow>(
        `SELECT id, run_id, label, content_sha256, media_type, storage_ref,
                byte_size::text, created_at
           FROM agent_world.artifacts
          WHERE project_id = $1
            AND ($2::text IS NULL OR label ILIKE '%' || $2 || '%'
                 OR storage_ref ILIKE '%' || $2 || '%')
          ORDER BY created_at DESC, id
          LIMIT 101`,
        [scope.project_id, request.query ?? null],
      );
      for (const artifact of artifacts.rows) {
        result.push({
          resource: "ARTIFACTS",
          content: serialize({
            id: artifact.id,
            runId: artifact.run_id,
            label: artifact.label,
            contentSha256: artifact.content_sha256,
            mediaType: artifact.media_type,
            storageRef: artifact.storage_ref,
            byteSize: Number(artifact.byte_size),
          }),
          provenance: [provenance("ARTIFACT", artifact.id, artifact.created_at)],
        });
      }
    }
    return result;
  }
}
