import { compileContextPack } from "@agent-world/conversation-service";
import {
  type ContextItem,
  ContextItemSchema,
  RunIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import { ContextPackStoreError, PostgresContextPackStore } from "./context-pack-store.js";
import type { TransactionPool } from "./conversation-store.js";

type ScopeRow = QueryResultRow & {
  run_id: string;
  task_id: string;
  agent_id: string;
  project_id: string;
  task_title: string;
  task_description: string | null;
  task_idempotency_key: string;
  task_created_at: Date | string;
  project_name: string;
  agent_slug: string;
  agent_display_name: string;
  agent_role: string;
  agent_instructions: string;
  agent_is_enabled: boolean;
  route_id: string;
  route_label: string;
  route_mode: string;
  route_adapter_kind: string;
  route_account_id: string | null;
  route_is_enabled: boolean;
};

type ContextRow = QueryResultRow & {
  id: string;
  project_id: string;
  kind: string;
  temperature: string;
  content: string;
  summary: string | null;
  content_sha256: string;
  estimated_tokens: number;
  importance: number;
  provenance_kind: string;
  event_id: string | null;
  message_id: string | null;
  run_id: string | null;
  artifact_id: string | null;
  document_chunk_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  skill_id: string | null;
  created_at: Date | string;
  valid_until: Date | string | null;
};

type ToolRow = QueryResultRow & { slug: string };

function iso(value: Date | string): string {
  return TimestampSchema.parse(value instanceof Date ? value.toISOString() : value);
}

function provenance(row: ContextRow): ContextItem["provenance"] {
  if (row.provenance_kind === "DOMAIN_EVENT" && row.event_id)
    return { kind: "DOMAIN_EVENT", eventId: row.event_id as never };
  if (row.provenance_kind === "MESSAGE" && row.message_id)
    return { kind: "MESSAGE", messageId: row.message_id as never };
  if (row.provenance_kind === "RUN" && row.run_id)
    return { kind: "RUN", runId: row.run_id as never };
  if (row.provenance_kind === "ARTIFACT" && row.artifact_id)
    return { kind: "ARTIFACT", artifactId: row.artifact_id as never };
  if (row.provenance_kind === "DOCUMENT_CHUNK" && row.document_chunk_id)
    return { kind: "DOCUMENT_CHUNK", documentChunkId: row.document_chunk_id as never };
  throw new Error("Canonical context provenance is invalid");
}

export class PostgresRunContextPackProvider {
  private readonly packs: PostgresContextPackStore;
  private readonly packId: () => string;
  private readonly now: () => string;
  private readonly tokenBudget: number;

  constructor(
    private readonly pool: TransactionPool,
    options: {
      packId?: () => string;
      now?: () => string;
      tokenBudget?: number;
      store?: PostgresContextPackStore;
    } = {},
  ) {
    this.packs = options.store ?? new PostgresContextPackStore(pool);
    this.packId =
      options.packId ??
      (() => {
        throw new Error("A production ContextPack identity generator is required");
      });
    this.now = options.now ?? (() => new Date().toISOString());
    this.tokenBudget = options.tokenBudget ?? 10_000;
  }

  async prepare(runIdValue: unknown) {
    const runId = RunIdSchema.parse(runIdValue);
    try {
      return await this.packs.readByRun(runId);
    } catch (error) {
      if (!(error instanceof ContextPackStoreError) || error.code !== "NOT_FOUND") throw error;
    }

    const client = await this.pool.connect();
    let scope: ScopeRow;
    let contexts: ContextRow[];
    let tools: ToolRow[];
    try {
      const scopeResult = await client.query<ScopeRow>(
        `SELECT r.id AS run_id, t.id AS task_id, t.assignee_agent_id AS agent_id,
                t.project_id, t.title AS task_title, t.description AS task_description,
                t.idempotency_key AS task_idempotency_key, t.created_at AS task_created_at,
                p.name AS project_name, a.slug AS agent_slug,
                a.display_name AS agent_display_name, a.role AS agent_role,
                a.instructions AS agent_instructions, a.is_enabled AS agent_is_enabled,
                route.id AS route_id, route.label AS route_label, route.mode AS route_mode,
                route.adapter_kind AS route_adapter_kind, route.account_id AS route_account_id,
                route.is_enabled AS route_is_enabled
           FROM agent_world.runs r
           JOIN agent_world.tasks t ON t.id = r.task_id AND t.assignee_agent_id = r.agent_id
           JOIN agent_world.projects p ON p.id = t.project_id
           JOIN agent_world.agents a ON a.id = r.agent_id
           JOIN agent_world.runtime_bindings binding ON binding.id = r.binding_id
           JOIN agent_world.execution_routes route ON route.id = binding.route_id
          WHERE r.id = $1 AND r.status = 'DISPATCH_PENDING'
            AND r.adapter_kind <> 'NATIVE_CHATGPT'`,
        [runId],
      );
      if (scopeResult.rows.length !== 1 || !scopeResult.rows[0]) {
        throw new Error("Run is not eligible for ContextPack compilation");
      }
      scope = scopeResult.rows[0];
      const contextResult = await client.query<ContextRow>(
        `SELECT id, project_id, kind, temperature, content, summary, content_sha256,
                estimated_tokens, importance, provenance_kind, event_id, message_id,
                run_id, artifact_id, document_chunk_id, agent_id, task_id, skill_id,
                created_at, valid_until
           FROM agent_world.context_items
          WHERE project_id = $1 AND (valid_until IS NULL OR valid_until > $2)
          ORDER BY importance DESC, created_at DESC, id
          LIMIT 500`,
        [scope.project_id, this.now()],
      );
      contexts = contextResult.rows;
      const toolResult = await client.query<ToolRow>(
        `SELECT tool.slug
           FROM agent_world.agent_tools assignment
           JOIN agent_world.tools tool ON tool.id = assignment.tool_id
          WHERE assignment.agent_id = $1 AND tool.is_enabled
          ORDER BY tool.slug
          LIMIT 100`,
        [scope.agent_id],
      );
      tools = toolResult.rows;
    } finally {
      client.release();
    }

    const contextItems = contexts.map((row) =>
      ContextItemSchema.parse({
        schemaVersion: 1,
        id: row.id,
        projectId: row.project_id,
        kind: row.kind,
        temperature: row.temperature,
        content: row.content,
        ...(row.summary === null ? {} : { summary: row.summary }),
        contentHash: row.content_sha256,
        estimatedTokens: row.estimated_tokens,
        importance: row.importance,
        provenance: provenance(row),
        ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
        ...(row.task_id === null ? {} : { taskId: row.task_id }),
        ...(row.skill_id === null ? {} : { skillId: row.skill_id }),
        createdAt: iso(row.created_at),
        ...(row.valid_until === null ? {} : { validUntil: iso(row.valid_until) }),
      }),
    );
    const explicitState = contextItems.find((item) => item.kind === "PROJECT_STATE");
    const compiledAt = this.now();
    const pack = compileContextPack(
      {
        schemaVersion: 1,
        packId: this.packId(),
        runId,
        task: {
          schemaVersion: 1,
          id: scope.task_id,
          projectId: scope.project_id,
          assigneeAgentId: scope.agent_id,
          title: scope.task_title,
          ...(scope.task_description === null ? {} : { description: scope.task_description }),
          approvalRequirement: "REQUIRED",
          idempotencyKey: scope.task_idempotency_key,
          createdAt: iso(scope.task_created_at),
        },
        agent: {
          schemaVersion: 1,
          id: scope.agent_id,
          slug: scope.agent_slug,
          displayName: scope.agent_display_name,
          role: scope.agent_role,
          instructions: scope.agent_instructions,
          isEnabled: scope.agent_is_enabled,
        },
        project: {
          id: scope.project_id,
          name: scope.project_name,
          state: explicitState?.content ?? "No explicit canonical project state has been recorded.",
        },
        route: {
          schemaVersion: 1,
          id: scope.route_id,
          label: scope.route_label,
          mode: scope.route_mode,
          adapterKind: scope.route_adapter_kind,
          ...(scope.route_account_id === null ? {} : { accountId: scope.route_account_id }),
          isEnabled: scope.route_is_enabled,
        },
        tokenBudget: this.tokenBudget,
        expectedOutput: "Return a verified result with concise evidence and explicit next actions.",
        handoffContract:
          "Preserve findings, decisions, artifacts, open questions, and next actions.",
        availableTools: tools.map(({ slug }) => slug),
      },
      contextItems.map((item) => ({ item, relevance: 1 })),
      compiledAt,
    );
    try {
      await this.packs.persist(pack);
      return pack;
    } catch (error) {
      if (error instanceof ContextPackStoreError && error.code === "IDEMPOTENCY_CONFLICT") {
        return this.packs.readByRun(runId);
      }
      throw error;
    }
  }
}
