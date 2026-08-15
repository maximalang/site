import { createHash } from "node:crypto";
import {
  ApprovalIdSchema,
  EventIdSchema,
  MissionIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type CandidateRow = QueryResultRow & {
  task_id: string;
  mission_id: string;
  agent_id: string;
  approval_id: string;
};
type PredecessorRow = QueryResultRow & { depends_on_task_id: string; run_id: string };
type PolicyCandidateRow = QueryResultRow & {
  task_id: string;
  mission_id: string;
  approval_id: string;
};

export type PolicyAuthorizedHandoff = {
  taskId: ReturnType<typeof TaskIdSchema.parse>;
  missionId: ReturnType<typeof MissionIdSchema.parse>;
  approvalId: ReturnType<typeof ApprovalIdSchema.parse>;
};

export class PostgresMissionHandoffStore {
  constructor(
    private readonly pool: TransactionPool,
    private readonly identities: { eventId(): string },
  ) {}

  async listPolicyAuthorized(limitInput = 25): Promise<PolicyAuthorizedHandoff[]> {
    const limit = Math.min(Math.max(Math.trunc(limitInput), 1), 100);
    const client = await this.pool.connect();
    try {
      const result = await client.query<PolicyCandidateRow>(
        `SELECT task.id AS task_id, task.mission_id, approval.id AS approval_id
           FROM agent_world.mission_handoff_activations activation
           JOIN agent_world.tasks task ON task.id = activation.task_id
           JOIN agent_world.missions mission ON mission.id = task.mission_id
           JOIN agent_world.approvals approval ON approval.id = activation.approval_id
          WHERE mission.status = 'ACTIVE'
            AND mission.execution_policy = 'AUTO_SAFE_HANDOFF'
            AND approval.state = 'PENDING'
            AND NOT EXISTS (SELECT 1 FROM agent_world.runs run WHERE run.task_id = task.id)
          ORDER BY activation.activated_at, task.id
          LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({
        taskId: TaskIdSchema.parse(row.task_id),
        missionId: MissionIdSchema.parse(row.mission_id),
        approvalId: ApprovalIdSchema.parse(row.approval_id),
      }));
    } finally {
      client.release();
    }
  }

  async activateReady(nowInput: unknown, limitInput = 25) {
    const now = TimestampSchema.parse(nowInput);
    const limit = Math.min(Math.max(Math.trunc(limitInput), 1), 100);
    const expiresAt = new Date(Date.parse(now) + 15 * 60_000).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const candidates = await client.query<CandidateRow>(
        `SELECT task.id AS task_id, task.mission_id, task.assignee_agent_id AS agent_id,
                approval.id AS approval_id
           FROM agent_world.tasks task
           JOIN agent_world.approvals approval ON approval.task_id = task.id
          WHERE task.mission_id IS NOT NULL
            AND approval.state = 'PENDING'
            AND EXISTS (
              SELECT 1 FROM agent_world.mission_task_dependencies dependency
               WHERE dependency.task_id = task.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM agent_world.mission_handoff_activations activation
               WHERE activation.task_id = task.id
            )
            AND NOT EXISTS (
              SELECT 1
                FROM agent_world.mission_task_dependencies dependency
               WHERE dependency.task_id = task.id
                 AND NOT EXISTS (
                   SELECT 1 FROM agent_world.runs run
                    WHERE run.task_id = dependency.depends_on_task_id
                      AND run.status = 'COMPLETED'
                 )
            )
          ORDER BY task.created_at, task.id
          LIMIT $1
          FOR UPDATE OF approval SKIP LOCKED`,
        [limit],
      );
      const activated = [];
      for (const row of candidates.rows) {
        const taskId = TaskIdSchema.parse(row.task_id);
        const missionId = MissionIdSchema.parse(row.mission_id);
        const approvalId = ApprovalIdSchema.parse(row.approval_id);
        const predecessors = await client.query<PredecessorRow>(
          `SELECT dependency.depends_on_task_id, run.id AS run_id
             FROM agent_world.mission_task_dependencies dependency
             JOIN agent_world.runs run
               ON run.task_id = dependency.depends_on_task_id AND run.status = 'COMPLETED'
            WHERE dependency.mission_id = $1 AND dependency.task_id = $2
            ORDER BY dependency.depends_on_task_id, run.id`,
          [missionId, taskId],
        );
        const predecessorRunIds = predecessors.rows.map((item) => RunIdSchema.parse(item.run_id));
        if (predecessorRunIds.length === 0)
          throw new Error("Ready handoff has no predecessor Runs");
        await client.query(
          `INSERT INTO agent_world.mission_handoff_activations
             (task_id, mission_id, approval_id, activated_at)
           VALUES ($1, $2, $3, $4)`,
          [taskId, missionId, approvalId, now],
        );
        await client.query(
          `UPDATE agent_world.approvals
              SET requested_at = $2, expires_at = $3
            WHERE id = $1 AND state = 'PENDING'`,
          [approvalId, now, expiresAt],
        );
        for (const predecessor of predecessors.rows) {
          const fromTaskId = TaskIdSchema.parse(predecessor.depends_on_task_id);
          const fromRunId = RunIdSchema.parse(predecessor.run_id);
          const payloadHash = createHash("sha256")
            .update(JSON.stringify({ missionId, fromTaskId, fromRunId, toTaskId: taskId }), "utf8")
            .digest("hex");
          await client.query(
            `INSERT INTO agent_world.mission_handoffs
               (id, mission_id, from_task_id, to_task_id, from_run_id,
                approval_id, payload_sha256, occurred_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              EventIdSchema.parse(this.identities.eventId()),
              missionId,
              fromTaskId,
              taskId,
              fromRunId,
              approvalId,
              payloadHash,
              now,
            ],
          );
        }
        const sequence = await client.query(
          `UPDATE agent_world.world_event_stream
              SET last_sequence = last_sequence + 1
            WHERE singleton = true
          RETURNING last_sequence`,
        );
        if (sequence.rows.length !== 1 || !sequence.rows[0])
          throw new Error("World sequence unavailable");
        await client.query(
          `INSERT INTO agent_world.world_events
             (sequence, id, occurred_at, source_kind, source_actor, command_id,
              event_type, agent_id, task_id, approval_id, approval_state,
              approval_requested_at, approval_expires_at)
           VALUES ($1, $2, $3, 'DOMAIN', 'SYSTEM_POLICY', $4,
                   'APPROVAL_STATE_CHANGED', $5, $6, $7, 'PENDING', $3, $8)`,
          [
            sequence.rows[0].last_sequence,
            EventIdSchema.parse(this.identities.eventId()),
            now,
            `mission-handoff:${taskId.slice("task_".length)}`,
            row.agent_id,
            taskId,
            approvalId,
            expiresAt,
          ],
        );
        activated.push({ taskId, approvalId, predecessorRunIds });
      }
      await client.query("COMMIT");
      return activated;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
