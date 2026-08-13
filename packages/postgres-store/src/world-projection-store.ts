import {
  type Agent,
  AgentIdSchema,
  AgentStatusSchema,
  BindingIdSchema,
  ConversationIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  OpaqueExternalIdSchema,
  TaskIdSchema,
  TaskIntentSchema,
  TimestampSchema,
} from "@agent-world/domain";
import {
  buildUnavailableWorldReadModel,
  buildWorldReadModel,
  type WorldReadModel,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const OpenClawStatusSchema = z.strictObject({
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  status: AgentStatusSchema,
});

const SnapshotSchema = z.strictObject({
  observedAt: TimestampSchema,
  observationId: OpaqueExternalIdSchema,
  statuses: z.array(OpenClawStatusSchema).max(1_000),
});

const AssignTaskSchema = z.strictObject({
  taskId: TaskIdSchema,
  conversationId: ConversationIdSchema,
  agentId: AgentIdSchema,
  title: TaskIntentSchema.shape.title,
  description: TaskIntentSchema.shape.description,
  idempotencyKey: IdempotencyKeySchema,
  createdAt: TimestampSchema,
});

type StatusRow = QueryResultRow & { status: string };
type EventRow = QueryResultRow & {
  sequence: string | number;
  id: string;
  occurred_at: Date | string;
  source_kind: string;
  adapter_kind: string | null;
  binding_id: string | null;
  external_event_id: string | null;
  command_id: string | null;
  event_type: string;
  agent_id: string;
  status: string | null;
  task_id: string | null;
};
type SequenceRow = QueryResultRow & { last_sequence: string | number };
type TaskRow = QueryResultRow & {
  id: string;
  conversation_id: string;
  project_id: string;
  assignee_agent_id: string;
  title: string;
  description: string | null;
  approval_requirement: string;
  idempotency_key: string;
  created_at: Date | string;
};
type TaskTargetRow = QueryResultRow & { project_id: string };

export type OpenClawWorldSnapshot = z.input<typeof SnapshotSchema>;
export type AssignTaskInput = z.input<typeof AssignTaskSchema>;
export type TaskAssignmentStoreErrorCode = "IDEMPOTENCY_CONFLICT" | "NO_ACTIVE_SESSION";

const TASK_ASSIGNMENT_STORE_ERROR_CODES = new Set<TaskAssignmentStoreErrorCode>([
  "IDEMPOTENCY_CONFLICT",
  "NO_ACTIVE_SESSION",
]);

export class TaskAssignmentStoreError extends Error {
  constructor(readonly code: TaskAssignmentStoreErrorCode) {
    super(code);
    this.name = "TaskAssignmentStoreError";
  }
}

export function isTaskAssignmentStoreError(
  input: unknown,
): input is { name: "TaskAssignmentStoreError"; code: TaskAssignmentStoreErrorCode } {
  if (typeof input !== "object" || input === null) return false;
  const candidate = input as { name?: unknown; code?: unknown };
  return (
    candidate.name === "TaskAssignmentStoreError" &&
    typeof candidate.code === "string" &&
    TASK_ASSIGNMENT_STORE_ERROR_CODES.has(candidate.code as TaskAssignmentStoreErrorCode)
  );
}

function safeSequence(input: string | number): number {
  const value = typeof input === "number" ? input : Number(input);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("World event sequence exceeds the safe read-model range");
  }
  return value;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseTask(row: TaskRow) {
  return TaskIntentSchema.parse({
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    assigneeAgentId: row.assignee_agent_id,
    title: row.title,
    ...(row.description === null ? {} : { description: row.description }),
    approvalRequirement: row.approval_requirement,
    idempotencyKey: row.idempotency_key,
    createdAt: iso(row.created_at),
  });
}

export class PostgresWorldProjectionStore {
  private readonly eventId: () => string;

  constructor(
    private readonly pool: TransactionPool,
    options: { eventId?: () => string } = {},
  ) {
    this.eventId =
      options.eventId ??
      (() => {
        throw new Error("A production World event identity generator is required");
      });
  }

  async applyOpenClawSnapshot(input: OpenClawWorldSnapshot): Promise<void> {
    const snapshot = SnapshotSchema.parse(input);
    const seenAgents = new Set<string>();
    const seenBindings = new Set<string>();
    for (const status of snapshot.statuses) {
      if (seenAgents.has(status.agentId) || seenBindings.has(status.bindingId)) {
        throw new Error("OpenClaw World snapshot contains duplicate canonical identity");
      }
      seenAgents.add(status.agentId);
      seenBindings.add(status.bindingId);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "agent_world:world_projection",
      ]);
      for (const status of snapshot.statuses.toSorted((left, right) =>
        left.agentId.localeCompare(right.agentId),
      )) {
        const current = await client.query<StatusRow>(
          `SELECT status
             FROM agent_world.world_agent_status
            WHERE agent_id = $1
            FOR UPDATE`,
          [status.agentId],
        );
        if (current.rows.length > 1) {
          throw new Error("World status projection returned an invalid cardinality");
        }
        if (current.rows[0]?.status === status.status) continue;

        const eventId = EventIdSchema.parse(this.eventId());
        const externalEventId = OpaqueExternalIdSchema.parse(
          `${snapshot.observationId}:${status.bindingId}`,
        );
        const sequence = await client.query<SequenceRow>(
          `UPDATE agent_world.world_event_stream
              SET last_sequence = last_sequence + 1
            WHERE singleton = true
          RETURNING last_sequence`,
        );
        if (sequence.rows.length !== 1 || !sequence.rows[0]) {
          throw new Error("World event stream counter is unavailable");
        }
        const nextSequence = safeSequence(sequence.rows[0].last_sequence);
        await client.query(
          `INSERT INTO agent_world.world_events
             (sequence, id, occurred_at, source_kind, adapter_kind, binding_id,
              external_event_id, event_type, agent_id, status)
           VALUES ($1, $2, $3, 'RUNTIME', 'OPENCLAW', $4, $5,
                   'AGENT_STATUS_CHANGED', $6, $7)`,
          [
            nextSequence,
            eventId,
            snapshot.observedAt,
            status.bindingId,
            externalEventId,
            status.agentId,
            status.status,
          ],
        );
        await client.query(
          `INSERT INTO agent_world.world_agent_status
             (agent_id, status, last_event_id, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (agent_id) DO UPDATE
             SET status = EXCLUDED.status,
                 last_event_id = EXCLUDED.last_event_id,
                 updated_at = EXCLUDED.updated_at`,
          [status.agentId, status.status, eventId, snapshot.observedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the projection failure; the pool will discard a broken client.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async assignTask(input: AssignTaskInput) {
    const command = AssignTaskSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        "agent_world:world_projection",
      ]);
      const existing = await client.query<TaskRow>(
        `SELECT id, conversation_id, project_id, assignee_agent_id, title, description,
                approval_requirement, idempotency_key, created_at
           FROM agent_world.tasks
          WHERE id = $1 OR idempotency_key = $2
          FOR UPDATE`,
        [command.taskId, command.idempotencyKey],
      );
      if (existing.rows.length > 1) {
        throw new TaskAssignmentStoreError("IDEMPOTENCY_CONFLICT");
      }
      if (existing.rows[0]) {
        const task = parseTask(existing.rows[0]);
        if (
          task.id !== command.taskId ||
          existing.rows[0].conversation_id !== command.conversationId ||
          task.assigneeAgentId !== command.agentId ||
          task.title !== command.title ||
          task.description !== command.description ||
          task.idempotencyKey !== command.idempotencyKey
        ) {
          throw new TaskAssignmentStoreError("IDEMPOTENCY_CONFLICT");
        }
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, task };
      }
      const target = await client.query<TaskTargetRow>(
        `SELECT c.project_id
           FROM agent_world.conversations c
           JOIN agent_world.conversation_sessions s
             ON s.conversation_id = c.id
            AND s.agent_id = c.agent_id
           JOIN agent_world.runtime_bindings b
             ON b.id = s.binding_id
            AND b.agent_id = s.agent_id
            AND b.adapter_kind = s.adapter_kind
          WHERE c.id = $1
            AND c.agent_id = $2
            AND s.ended_at IS NULL
            AND s.adapter_kind = 'OPENCLAW'
            AND b.is_enabled = true
          FOR SHARE OF c, s, b`,
        [command.conversationId, command.agentId],
      );
      if (target.rows.length !== 1 || !target.rows[0]) {
        throw new TaskAssignmentStoreError("NO_ACTIVE_SESSION");
      }
      const task = TaskIntentSchema.parse({
        schemaVersion: 1,
        id: command.taskId,
        projectId: target.rows[0].project_id,
        assigneeAgentId: command.agentId,
        title: command.title,
        ...(command.description === undefined ? {} : { description: command.description }),
        approvalRequirement: "REQUIRED",
        idempotencyKey: command.idempotencyKey,
        createdAt: command.createdAt,
      });
      await client.query(
        `INSERT INTO agent_world.tasks
           (id, conversation_id, project_id, assignee_agent_id, title, description,
            approval_requirement, idempotency_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'REQUIRED', $7, $8)`,
        [
          task.id,
          command.conversationId,
          task.projectId,
          task.assigneeAgentId,
          task.title,
          task.description ?? null,
          task.idempotencyKey,
          task.createdAt,
        ],
      );
      const eventId = EventIdSchema.parse(this.eventId());
      const sequence = await client.query<SequenceRow>(
        `UPDATE agent_world.world_event_stream
            SET last_sequence = last_sequence + 1
          WHERE singleton = true
        RETURNING last_sequence`,
      );
      if (sequence.rows.length !== 1 || !sequence.rows[0]) {
        throw new Error("World event stream counter is unavailable");
      }
      await client.query(
        `INSERT INTO agent_world.world_events
           (sequence, id, occurred_at, source_kind, command_id,
            event_type, agent_id, task_id)
         VALUES ($1, $2, $3, 'DOMAIN', $4, 'TASK_ASSIGNED', $5, $6)`,
        [
          safeSequence(sequence.rows[0].last_sequence),
          eventId,
          task.createdAt,
          task.idempotencyKey,
          task.assigneeAgentId,
          task.id,
        ],
      );
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, task };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the task assignment failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async readWorld(agents: Agent[]): Promise<WorldReadModel> {
    if (agents.length === 0) {
      return buildUnavailableWorldReadModel(new Date(0).toISOString());
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const tasks = await client.query<TaskRow>(
        `SELECT id, conversation_id, project_id, assignee_agent_id, title, description,
                  approval_requirement, idempotency_key, created_at
             FROM agent_world.tasks
            ORDER BY created_at, id
            LIMIT 2001`,
      );
      const events = await client.query<EventRow>(
        `SELECT sequence, id, occurred_at, source_kind, adapter_kind,
                  binding_id, external_event_id, command_id, event_type,
                  agent_id, status, task_id
             FROM agent_world.world_events
            ORDER BY sequence
            LIMIT 100001`,
      );
      if (tasks.rows.length > 2_000 || events.rows.length > 100_000) {
        throw new Error("World projection exceeds the bounded replay limit");
      }
      const worldEvents = events.rows.map((row) => ({
        schemaVersion: 1 as const,
        id: row.id,
        sequence: safeSequence(row.sequence),
        occurredAt: iso(row.occurred_at),
        source:
          row.source_kind === "RUNTIME"
            ? {
                kind: "RUNTIME" as const,
                adapterKind: row.adapter_kind,
                bindingId: row.binding_id,
                externalEventId: row.external_event_id,
              }
            : {
                kind: "DOMAIN" as const,
                actor: "OWNER" as const,
                commandId: row.command_id,
              },
        eventType: row.event_type,
        payload:
          row.event_type === "AGENT_STATUS_CHANGED"
            ? { agentId: row.agent_id, status: row.status }
            : { taskId: row.task_id, agentId: row.agent_id },
      }));
      const latest = events.rows.at(-1);
      const model = buildWorldReadModel({
        source: "LIVE",
        generatedAt: latest ? iso(latest.occurred_at) : new Date(0).toISOString(),
        agents,
        tasks: tasks.rows.map(parseTask),
        events: worldEvents,
      });
      await client.query("COMMIT");
      return model;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the projection read failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
