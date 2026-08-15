import { createHash } from "node:crypto";
import {
  type AgentSchedule,
  AgentScheduleSchema,
  ApprovalIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  ScheduleFiringIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type ScheduleRow = QueryResultRow & {
  id: string;
  project_id: string;
  agent_id: string;
  mission_id: string | null;
  title: string;
  task_description: string | null;
  cron_expression: string;
  timezone: string;
  is_enabled: boolean;
  next_fire_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  request_sha256: string;
};

export type ScheduleStoreIdentities = {
  taskId(): string;
  firingId(): string;
  eventId(): string;
};

export type ScheduleRecurrence = (input: {
  expression: string;
  timezone: string;
  after: string;
}) => string;

export class ScheduleStoreError extends Error {
  constructor(readonly code: "SCHEDULE_CONFLICT" | "SCHEDULE_INVALID") {
    super(code);
    this.name = "ScheduleStoreError";
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function fromRow(row: ScheduleRow): AgentSchedule {
  return AgentScheduleSchema.parse({
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    ...(row.mission_id === null ? {} : { missionId: row.mission_id }),
    title: row.title,
    ...(row.task_description === null ? {} : { taskDescription: row.task_description }),
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    isEnabled: row.is_enabled,
    ...(row.next_fire_at === null ? {} : { nextFireAt: iso(row.next_fire_at) }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

const SELECT_SCHEDULE = `SELECT id, project_id, agent_id, mission_id, title, task_description,
       cron_expression, timezone, is_enabled, next_fire_at, created_at, updated_at, request_sha256
  FROM agent_world.agent_schedules
 WHERE id = $1`;

export class PostgresScheduleStore {
  constructor(
    private readonly pool: TransactionPool,
    private readonly recurrence: ScheduleRecurrence,
    private readonly identities: ScheduleStoreIdentities,
  ) {}

  async list(limitInput = 100): Promise<AgentSchedule[]> {
    const limit = Math.min(Math.max(Math.trunc(limitInput), 1), 250);
    const client = await this.pool.connect();
    try {
      const result = await client.query<ScheduleRow>(
        `SELECT id, project_id, agent_id, mission_id, title, task_description,
                cron_expression, timezone, is_enabled, next_fire_at, created_at, updated_at,
                request_sha256
           FROM agent_world.agent_schedules
          ORDER BY created_at DESC, id
          LIMIT $1`,
        [limit],
      );
      return result.rows.map(fromRow);
    } finally {
      client.release();
    }
  }

  async create(input: unknown) {
    const schedule = AgentScheduleSchema.parse(input);
    const requestHash = createHash("sha256").update(JSON.stringify(schedule), "utf8").digest("hex");
    const expectedNext = this.recurrence({
      expression: schedule.cronExpression,
      timezone: schedule.timezone,
      after: schedule.createdAt,
    });
    if (schedule.isEnabled && schedule.nextFireAt !== expectedNext) {
      throw new ScheduleStoreError("SCHEDULE_INVALID");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:schedule:${schedule.id}`,
      ]);
      const existing = await client.query<ScheduleRow>(SELECT_SCHEDULE, [schedule.id]);
      if (existing.rows[0]) {
        const stored = fromRow(existing.rows[0]);
        if (existing.rows[0].request_sha256 !== requestHash) {
          throw new ScheduleStoreError("SCHEDULE_CONFLICT");
        }
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, schedule: stored };
      }
      const inserted = await client.query(
        `INSERT INTO agent_world.agent_schedules
           (id, project_id, agent_id, mission_id, title, task_description,
            cron_expression, timezone, is_enabled, next_fire_at, created_at, updated_at,
            request_sha256)
         SELECT $1, membership.project_id, membership.agent_id, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13
           FROM agent_world.project_agents membership
          WHERE membership.project_id = $2 AND membership.agent_id = $3
         RETURNING id`,
        [
          schedule.id,
          schedule.projectId,
          schedule.agentId,
          schedule.missionId ?? null,
          schedule.title,
          schedule.taskDescription ?? null,
          schedule.cronExpression,
          schedule.timezone,
          schedule.isEnabled,
          schedule.nextFireAt ?? null,
          schedule.createdAt,
          schedule.updatedAt,
          requestHash,
        ],
      );
      if (inserted.rows.length !== 1) throw new ScheduleStoreError("SCHEDULE_CONFLICT");
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, schedule };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async materializeDue(nowInput: unknown, limitInput = 25) {
    const now = TimestampSchema.parse(nowInput);
    const limit = Math.min(Math.max(Math.trunc(limitInput), 1), 100);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query<ScheduleRow>(
        `SELECT id, project_id, agent_id, mission_id, title, task_description,
                cron_expression, timezone, is_enabled, next_fire_at, created_at, updated_at,
                request_sha256
           FROM agent_world.agent_schedules
          WHERE is_enabled = true AND next_fire_at <= $1
         ORDER BY next_fire_at, id
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      const firings: Array<{ scheduleId: string; firingId: string; taskId: string }> = [];
      for (const row of due.rows) {
        const schedule = fromRow(row);
        if (!schedule.nextFireAt) throw new ScheduleStoreError("SCHEDULE_INVALID");
        const taskId = TaskIdSchema.parse(this.identities.taskId());
        const firingId = ScheduleFiringIdSchema.parse(this.identities.firingId());
        const approvalId = ApprovalIdSchema.parse(`approval_${taskId.slice("task_".length)}`);
        const idempotencyKey = IdempotencyKeySchema.parse(
          `schedule:${schedule.id.slice("schedule_".length)}:${Date.parse(schedule.nextFireAt)}`,
        );
        const expiresAt = new Date(Date.parse(now) + 15 * 60 * 1_000).toISOString();
        const nextFireAt = this.recurrence({
          expression: schedule.cronExpression,
          timezone: schedule.timezone,
          after: now,
        });
        await client.query(
          `INSERT INTO agent_world.tasks
             (id, conversation_id, project_id, mission_id, assignee_agent_id,
              title, description, approval_requirement, idempotency_key, created_at)
           VALUES ($1, NULL, $2, $3, $4, $5, $6, 'REQUIRED', $7, $8)`,
          [
            taskId,
            schedule.projectId,
            schedule.missionId ?? null,
            schedule.agentId,
            schedule.title,
            schedule.taskDescription ?? null,
            idempotencyKey,
            now,
          ],
        );
        await client.query(
          `INSERT INTO agent_world.approvals
             (id, task_id, state, requested_at, expires_at)
           VALUES ($1, $2, 'PENDING', $3, $4)`,
          [approvalId, taskId, now, expiresAt],
        );
        await client.query(
          `INSERT INTO agent_world.schedule_firings
             (id, schedule_id, scheduled_for, task_id, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [firingId, schedule.id, schedule.nextFireAt, taskId, now],
        );
        await this.appendWorldEvent(client, {
          eventType: "TASK_ASSIGNED",
          occurredAt: now,
          commandId: idempotencyKey,
          agentId: schedule.agentId,
          taskId,
        });
        await this.appendWorldEvent(client, {
          eventType: "APPROVAL_STATE_CHANGED",
          occurredAt: now,
          commandId: idempotencyKey,
          agentId: schedule.agentId,
          taskId,
          approvalId,
          expiresAt,
        });
        await client.query(
          `UPDATE agent_world.agent_schedules
              SET last_fire_at = next_fire_at, next_fire_at = $2, updated_at = $3
            WHERE id = $1`,
          [schedule.id, nextFireAt, now],
        );
        firings.push({ scheduleId: schedule.id, firingId, taskId });
      }
      await client.query("COMMIT");
      return firings;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendWorldEvent(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    input:
      | {
          eventType: "TASK_ASSIGNED";
          occurredAt: string;
          commandId: string;
          agentId: string;
          taskId: string;
        }
      | {
          eventType: "APPROVAL_STATE_CHANGED";
          occurredAt: string;
          commandId: string;
          agentId: string;
          taskId: string;
          approvalId: string;
          expiresAt: string;
        },
  ) {
    const sequence = await client.query(
      `UPDATE agent_world.world_event_stream
          SET last_sequence = last_sequence + 1
        WHERE singleton = true
      RETURNING last_sequence`,
    );
    if (sequence.rows.length !== 1 || !sequence.rows[0]) {
      throw new ScheduleStoreError("SCHEDULE_CONFLICT");
    }
    const eventId = EventIdSchema.parse(this.identities.eventId());
    await client.query(
      input.eventType === "TASK_ASSIGNED"
        ? `INSERT INTO agent_world.world_events
             (sequence, id, occurred_at, source_kind, source_actor, command_id,
              event_type, agent_id, task_id)
           VALUES ($1, $2, $3, 'DOMAIN', 'SYSTEM_POLICY', $4,
                   'TASK_ASSIGNED', $5, $6)`
        : `INSERT INTO agent_world.world_events
             (sequence, id, occurred_at, source_kind, source_actor, command_id,
              event_type, agent_id, task_id, approval_id, approval_state,
              approval_requested_at, approval_expires_at)
           VALUES ($1, $2, $3, 'DOMAIN', 'SYSTEM_POLICY', $4,
                   'APPROVAL_STATE_CHANGED', $5, $6, $7, 'PENDING', $3, $8)`,
      input.eventType === "TASK_ASSIGNED"
        ? [
            sequence.rows[0].last_sequence,
            eventId,
            input.occurredAt,
            input.commandId,
            input.agentId,
            input.taskId,
          ]
        : [
            sequence.rows[0].last_sequence,
            eventId,
            input.occurredAt,
            input.commandId,
            input.agentId,
            input.taskId,
            input.approvalId,
            input.expiresAt,
          ],
    );
  }
}
