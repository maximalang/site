import {
  type Agent,
  AgentIdSchema,
  AgentStatusSchema,
  ApprovalIdSchema,
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
  source_actor: string | null;
  adapter_kind: string | null;
  binding_id: string | null;
  external_event_id: string | null;
  command_id: string | null;
  event_type: string;
  agent_id: string;
  status: string | null;
  task_id: string | null;
  run_id: string | null;
  approval_id: string | null;
  approval_state: string | null;
  approval_requested_at: Date | string | null;
  approval_expires_at: Date | string | null;
  approval_decided_at: Date | string | null;
  approval_reason: string | null;
};
type SequenceRow = QueryResultRow & { last_sequence: string | number };
type TaskRow = QueryResultRow & {
  id: string;
  conversation_id: string | null;
  project_id: string;
  mission_id: string | null;
  assignee_agent_id: string;
  title: string;
  description: string | null;
  approval_requirement: string;
  idempotency_key: string;
  created_at: Date | string;
};
type TaskTargetRow = QueryResultRow & { project_id: string };
type HandoffRow = QueryResultRow & {
  id: string;
  mission_id: string;
  from_task_id: string;
  to_task_id: string;
  from_run_id: string;
  from_agent_id: string;
  to_agent_id: string;
  occurred_at: Date | string;
};

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
    ...(row.mission_id === null ? {} : { missionId: row.mission_id }),
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
        `SELECT id, conversation_id, project_id, mission_id, assignee_agent_id, title, description,
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
            AND s.adapter_kind IN ('OPENCLAW', 'CODEX', 'API_MODEL', 'LOCAL_MODEL')
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
      const approvalId = ApprovalIdSchema.parse(`approval_${task.id.slice("task_".length)}`);
      const expiresAt = new Date(Date.parse(task.createdAt) + 15 * 60 * 1_000).toISOString();
      await client.query(
        `INSERT INTO agent_world.approvals
           (id, task_id, state, requested_at, expires_at)
         VALUES ($1, $2, 'PENDING', $3, $4)`,
        [approvalId, task.id, task.createdAt, expiresAt],
      );
      const taskEventId = EventIdSchema.parse(this.eventId());
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
           (sequence, id, occurred_at, source_kind, source_actor, command_id,
            event_type, agent_id, task_id)
         VALUES ($1, $2, $3, 'DOMAIN', 'OWNER', $4, 'TASK_ASSIGNED', $5, $6)`,
        [
          safeSequence(sequence.rows[0].last_sequence),
          taskEventId,
          task.createdAt,
          task.idempotencyKey,
          task.assigneeAgentId,
          task.id,
        ],
      );
      const approvalEventId = EventIdSchema.parse(this.eventId());
      const approvalSequence = await client.query<SequenceRow>(
        `UPDATE agent_world.world_event_stream
            SET last_sequence = last_sequence + 1
          WHERE singleton = true
        RETURNING last_sequence`,
      );
      if (approvalSequence.rows.length !== 1 || !approvalSequence.rows[0]) {
        throw new Error("World event stream counter is unavailable");
      }
      await client.query(
        `INSERT INTO agent_world.world_events
           (sequence, id, occurred_at, source_kind, source_actor, command_id,
            event_type, agent_id, task_id, approval_id, approval_state,
            approval_requested_at, approval_expires_at)
         VALUES ($1, $2, $3, 'DOMAIN', 'OWNER', $4, 'APPROVAL_STATE_CHANGED',
                 $5, $6, $7, 'PENDING', $3, $8)`,
        [
          safeSequence(approvalSequence.rows[0].last_sequence),
          approvalEventId,
          task.createdAt,
          task.idempotencyKey,
          task.assigneeAgentId,
          task.id,
          approvalId,
          expiresAt,
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
        `SELECT id, conversation_id, project_id, mission_id, assignee_agent_id, title, description,
                  approval_requirement, idempotency_key, created_at
             FROM agent_world.tasks
            ORDER BY created_at, id
            LIMIT 2001`,
      );
      const events = await client.query<EventRow>(
        `SELECT sequence, id, occurred_at, source_kind, source_actor, adapter_kind,
                  binding_id, external_event_id, command_id, event_type,
                  agent_id, status, task_id, run_id, approval_id, approval_state,
                  approval_requested_at, approval_expires_at, approval_decided_at,
                  approval_reason
             FROM agent_world.world_events
            ORDER BY sequence
            LIMIT 100001`,
      );
      const handoffs = await client.query<HandoffRow>(
        `SELECT handoff.id, handoff.mission_id, handoff.from_task_id,
                handoff.to_task_id, handoff.from_run_id,
                source_task.assignee_agent_id AS from_agent_id,
                target_task.assignee_agent_id AS to_agent_id,
                handoff.occurred_at
           FROM agent_world.mission_handoffs handoff
           JOIN agent_world.tasks source_task ON source_task.id = handoff.from_task_id
           JOIN agent_world.tasks target_task ON target_task.id = handoff.to_task_id
          ORDER BY handoff.occurred_at DESC, handoff.sequence DESC
          LIMIT 21`,
      );
      if (tasks.rows.length > 2_000 || events.rows.length > 100_000 || handoffs.rows.length > 20) {
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
                actor: row.source_actor,
                commandId: row.command_id,
              },
        eventType: row.event_type,
        payload:
          row.event_type === "AGENT_STATUS_CHANGED"
            ? {
                agentId: row.agent_id,
                status: row.status,
                ...(row.task_id === null ? {} : { taskId: row.task_id }),
                ...(row.run_id === null ? {} : { runId: row.run_id }),
              }
            : row.event_type === "TASK_ASSIGNED"
              ? { taskId: row.task_id, agentId: row.agent_id }
              : {
                  taskId: row.task_id,
                  state:
                    row.approval_state === "PENDING"
                      ? {
                          type: "PENDING" as const,
                          approvalId: row.approval_id,
                          requestedAt:
                            row.approval_requested_at === null
                              ? null
                              : iso(row.approval_requested_at),
                          expiresAt:
                            row.approval_expires_at === null ? null : iso(row.approval_expires_at),
                        }
                      : row.approval_state === "APPROVED"
                        ? {
                            type: "APPROVED" as const,
                            approvalId: row.approval_id,
                            decidedAt:
                              row.approval_decided_at === null
                                ? null
                                : iso(row.approval_decided_at),
                          }
                        : {
                            type: row.approval_state,
                            approvalId: row.approval_id,
                            decidedAt:
                              row.approval_decided_at === null
                                ? null
                                : iso(row.approval_decided_at),
                            reason: row.approval_reason,
                          },
                },
      }));
      const latest = events.rows.at(-1);
      const model = buildWorldReadModel({
        source: "LIVE",
        generatedAt: latest ? iso(latest.occurred_at) : new Date(0).toISOString(),
        agents,
        tasks: tasks.rows.map(parseTask),
        events: worldEvents,
        handoffs: handoffs.rows.toReversed().map((row) => ({
          id: row.id,
          missionId: row.mission_id,
          fromTaskId: row.from_task_id,
          toTaskId: row.to_task_id,
          fromRunId: row.from_run_id,
          fromAgentId: row.from_agent_id,
          toAgentId: row.to_agent_id,
          occurredAt: iso(row.occurred_at),
        })),
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
