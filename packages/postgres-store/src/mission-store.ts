import { createHash } from "node:crypto";
import {
  type AgentInstanceAssignment,
  AgentInstanceAssignmentSchema,
  type AgentTemplate,
  AgentTemplateSchema,
  ApprovalIdSchema,
  EventIdSchema,
  IdempotencyKeySchema,
  type Mission,
  type MissionDecomposition,
  MissionDecompositionIdSchema,
  MissionDecompositionSchema,
  MissionIdSchema,
  MissionSchema,
  type StructuredMeeting,
  StructuredMeetingSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

export type MissionStoreErrorCode =
  | "MISSION_CONFLICT"
  | "MISSION_NOT_FOUND"
  | "TEMPLATE_CONFLICT"
  | "ASSIGNMENT_CONFLICT"
  | "DECOMPOSITION_CONFLICT"
  | "MEETING_CONFLICT"
  | "MATERIALIZATION_CONFLICT";

export class MissionStoreError extends Error {
  constructor(readonly code: MissionStoreErrorCode) {
    super(code);
    this.name = "MissionStoreError";
  }
}

function timestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

type MissionRow = QueryResultRow & {
  id: string;
  project_id: string;
  title: string;
  goal: string;
  status: string;
  execution_policy: string;
  created_at: Date | string;
  updated_at: Date | string;
  success_criteria: unknown;
};

type TemplateRow = QueryResultRow & {
  id: string;
  version: number;
  slug: string;
  display_name: string;
  role: string;
  instructions: string;
  skill_ids: unknown;
  tool_ids: unknown;
  created_at: Date | string;
};

type AssignmentRow = QueryResultRow & {
  agent_id: string;
  template_id: string;
  template_version: number;
  project_id: string;
  mission_id: string | null;
  created_at: Date | string;
};

type WorkflowRow = QueryResultRow & {
  mission_status: string;
  pending_criteria: number;
  task_ids: unknown;
  run_ids: unknown;
  completed_task_ids: unknown;
  failed_task_ids: unknown;
  retry_count: number;
  last_event_id: string | null;
};

function missionFromRow(row: MissionRow): Mission {
  return MissionSchema.parse({
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    executionPolicy: row.execution_policy,
    successCriteria: row.success_criteria,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  });
}

function templateFromRow(row: TemplateRow): AgentTemplate {
  return AgentTemplateSchema.parse({
    schemaVersion: 1,
    id: row.id,
    version: row.version,
    slug: row.slug,
    displayName: row.display_name,
    role: row.role,
    instructions: row.instructions,
    skillIds: row.skill_ids,
    toolIds: row.tool_ids,
    createdAt: timestamp(row.created_at),
  });
}

function assignmentFromRow(row: AssignmentRow): AgentInstanceAssignment {
  return AgentInstanceAssignmentSchema.parse({
    schemaVersion: 1,
    agentId: row.agent_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    projectId: row.project_id,
    ...(row.mission_id ? { missionId: row.mission_id } : {}),
    createdAt: timestamp(row.created_at),
  });
}

const SELECT_MISSION = `SELECT m.id, m.project_id, m.title, m.goal, m.status, m.execution_policy,
       m.created_at, m.updated_at,
       COALESCE(jsonb_agg(jsonb_build_object(
         'id', c.id,
         'statement', c.statement,
         'verification', c.verification,
         'status', c.status,
         'evidenceRefs', c.evidence_refs
       ) ORDER BY c.criterion_position) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS success_criteria
  FROM agent_world.missions m
  LEFT JOIN agent_world.mission_success_criteria c ON c.mission_id = m.id
 WHERE m.id = $1
 GROUP BY m.id`;

const SELECT_TEMPLATE = `SELECT t.id, t.version, t.slug, t.display_name, t.role,
       t.instructions, t.created_at,
       COALESCE((SELECT jsonb_agg(s.skill_id ORDER BY s.skill_id)
                   FROM agent_world.agent_template_skills s
                  WHERE s.agent_template_id = t.id
                    AND s.agent_template_version = t.version), '[]'::jsonb) AS skill_ids,
       COALESCE((SELECT jsonb_agg(x.tool_id ORDER BY x.tool_id)
                   FROM agent_world.agent_template_tools x
                  WHERE x.agent_template_id = t.id
                    AND x.agent_template_version = t.version), '[]'::jsonb) AS tool_ids
  FROM agent_world.agent_templates t
 WHERE t.id = $1 AND t.version = $2`;

export class PostgresMissionStore {
  constructor(
    private readonly pool: TransactionPool,
    private readonly identities: { eventId?: () => string } = {},
  ) {}

  async createMission(input: unknown) {
    const mission = MissionSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:mission:${mission.id}`,
      ]);
      const existing = await client.query<MissionRow>(SELECT_MISSION, [mission.id]);
      if (existing.rows[0]) {
        const stored = missionFromRow(existing.rows[0]);
        if (!same(stored, mission)) throw new MissionStoreError("MISSION_CONFLICT");
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, mission: stored };
      }
      await client.query(
        `INSERT INTO agent_world.missions
           (id, project_id, title, goal, status, execution_policy, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          mission.id,
          mission.projectId,
          mission.title,
          mission.goal,
          mission.status,
          mission.executionPolicy,
          mission.createdAt,
          mission.updatedAt,
        ],
      );
      for (const [criterionPosition, criterion] of mission.successCriteria.entries()) {
        await client.query(
          `INSERT INTO agent_world.mission_success_criteria
             (id, mission_id, criterion_position, statement, verification, status, evidence_refs)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            criterion.id,
            mission.id,
            criterionPosition,
            criterion.statement,
            criterion.verification,
            criterion.status,
            JSON.stringify(criterion.evidenceRefs),
          ],
        );
      }
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, mission };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createTemplate(input: unknown) {
    const template = AgentTemplateSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:agent_template:${template.id}:${template.version}`,
      ]);
      const existing = await client.query<TemplateRow>(SELECT_TEMPLATE, [
        template.id,
        template.version,
      ]);
      if (existing.rows[0]) {
        const stored = templateFromRow(existing.rows[0]);
        if (!same(stored, template)) throw new MissionStoreError("TEMPLATE_CONFLICT");
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, template: stored };
      }
      await client.query(
        `INSERT INTO agent_world.agent_templates
           (id, version, slug, display_name, role, instructions, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          template.id,
          template.version,
          template.slug,
          template.displayName,
          template.role,
          template.instructions,
          template.createdAt,
        ],
      );
      for (const skillId of template.skillIds) {
        await client.query(
          `INSERT INTO agent_world.agent_template_skills
             (agent_template_id, agent_template_version, skill_id)
           VALUES ($1, $2, $3)`,
          [template.id, template.version, skillId],
        );
      }
      for (const toolId of template.toolIds) {
        await client.query(
          `INSERT INTO agent_world.agent_template_tools
             (agent_template_id, agent_template_version, tool_id)
           VALUES ($1, $2, $3)`,
          [template.id, template.version, toolId],
        );
      }
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, template };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async assignAgent(input: unknown) {
    const assignment = AgentInstanceAssignmentSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:agent_assignment:${assignment.agentId}:${assignment.projectId}`,
      ]);
      const existing = await client.query<AssignmentRow>(
        `SELECT agent_id, template_id, template_version, project_id, mission_id, created_at
           FROM agent_world.agent_instance_assignments
          WHERE agent_id = $1 AND project_id = $2`,
        [assignment.agentId, assignment.projectId],
      );
      if (existing.rows[0]) {
        const stored = assignmentFromRow(existing.rows[0]);
        if (!same(stored, assignment)) throw new MissionStoreError("ASSIGNMENT_CONFLICT");
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, assignment: stored };
      }
      const updated = await client.query(
        `UPDATE agent_world.agents
            SET template_id = $2, template_version = $3
          WHERE id = $1
            AND (template_id IS NULL OR (template_id = $2 AND template_version = $3))
        RETURNING id`,
        [assignment.agentId, assignment.templateId, assignment.templateVersion],
      );
      if (updated.rows.length !== 1) throw new MissionStoreError("ASSIGNMENT_CONFLICT");
      await client.query(
        `INSERT INTO agent_world.agent_instance_assignments
           (agent_id, template_id, template_version, project_id, mission_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          assignment.agentId,
          assignment.templateId,
          assignment.templateVersion,
          assignment.projectId,
          assignment.missionId ?? null,
          assignment.createdAt,
        ],
      );
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, assignment };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async readWorkflowState(missionIdInput: unknown) {
    const missionId = MissionIdSchema.parse(missionIdInput);
    const client = await this.pool.connect();
    try {
      const result = await client.query<WorkflowRow>(
        `SELECT mission.status AS mission_status,
              (SELECT count(*)::integer
                 FROM agent_world.mission_success_criteria criterion
                WHERE criterion.mission_id = mission.id
                  AND criterion.status = 'PENDING') AS pending_criteria,
              COALESCE((SELECT jsonb_agg(task.id ORDER BY task.id)
                          FROM agent_world.tasks task
                         WHERE task.mission_id = mission.id), '[]'::jsonb) AS task_ids,
              COALESCE((SELECT jsonb_agg(run.id ORDER BY run.id)
                          FROM agent_world.runs run
                          JOIN agent_world.tasks task ON task.id = run.task_id
                         WHERE task.mission_id = mission.id), '[]'::jsonb) AS run_ids,
              COALESCE((SELECT jsonb_agg(task.id ORDER BY task.id)
                          FROM agent_world.tasks task
                          JOIN agent_world.runs run ON run.task_id = task.id
                         WHERE task.mission_id = mission.id
                           AND run.status = 'COMPLETED'), '[]'::jsonb) AS completed_task_ids,
              COALESCE((SELECT jsonb_agg(task.id ORDER BY task.id)
                          FROM agent_world.tasks task
                          JOIN agent_world.runs run ON run.task_id = task.id
                         WHERE task.mission_id = mission.id
                           AND run.status = 'FAILED'), '[]'::jsonb) AS failed_task_ids,
              COALESCE((SELECT greatest(max(run.attempt) - 1, 0)::integer
                          FROM agent_world.runs run
                          JOIN agent_world.tasks task ON task.id = run.task_id
                         WHERE task.mission_id = mission.id), 0) AS retry_count,
              (SELECT event.id
                 FROM (
                   SELECT world.id, world.occurred_at
                     FROM agent_world.world_events world
                     JOIN agent_world.tasks task ON task.id = world.task_id
                    WHERE task.mission_id = mission.id
                   UNION ALL
                   SELECT collaboration.id, collaboration.occurred_at
                     FROM agent_world.mission_collaboration_events collaboration
                    WHERE collaboration.mission_id = mission.id
                 ) event
                ORDER BY event.occurred_at DESC, event.id DESC
                LIMIT 1) AS last_event_id
         FROM agent_world.missions mission
        WHERE mission.id = $1`,
        [missionId],
      );
      const row = result.rows[0];
      if (!row || result.rows.length !== 1) throw new MissionStoreError("MISSION_NOT_FOUND");
      const taskIds = Array.isArray(row.task_ids) ? row.task_ids : [];
      const completedTaskIds = Array.isArray(row.completed_task_ids) ? row.completed_task_ids : [];
      const failedTaskIds = Array.isArray(row.failed_task_ids) ? row.failed_task_ids : [];
      const phase =
        row.mission_status === "SUCCEEDED"
          ? "COMPLETED"
          : row.mission_status === "FAILED" || row.mission_status === "CANCELLED"
            ? "FAILED"
            : taskIds.length === 0
              ? "PLANNING"
              : completedTaskIds.length + failedTaskIds.length === taskIds.length
                ? "REVIEWING"
                : "EXECUTING";
      return {
        schemaVersion: 1 as const,
        missionId,
        taskIds,
        runIds: Array.isArray(row.run_ids) ? row.run_ids : [],
        completedTaskIds,
        failedTaskIds,
        ...(row.last_event_id === null ? {} : { lastEventId: row.last_event_id }),
        phase,
        retryCount: row.retry_count,
        maxRetries: 2,
        reviewRequired: row.pending_criteria > 0,
      };
    } finally {
      client.release();
    }
  }

  async createDecomposition(input: unknown) {
    const decomposition: MissionDecomposition = MissionDecompositionSchema.parse(input);
    return this.persistCollaboration(
      "DECOMPOSITION_CONFLICT",
      decomposition.id,
      decomposition,
      async (client, payloadHash) => {
        const inserted = await client.query(
          `INSERT INTO agent_world.mission_decompositions
             (id, mission_id, project_id, source_event_id, rationale,
              payload, payload_sha256, created_at)
           SELECT $1, mission.id, mission.project_id, $4, $5, $6::jsonb, $7, $8
             FROM agent_world.missions mission
             JOIN agent_world.world_events event ON event.id = $4
             JOIN agent_world.project_agents source_membership
               ON source_membership.project_id = mission.project_id
              AND source_membership.agent_id = event.agent_id
            WHERE mission.id = $2 AND mission.project_id = $3
           RETURNING id`,
          [
            decomposition.id,
            decomposition.missionId,
            decomposition.projectId,
            decomposition.sourceEventId,
            decomposition.rationale,
            JSON.stringify(decomposition),
            payloadHash,
            decomposition.createdAt,
          ],
        );
        if (inserted.rows.length !== 1) throw new MissionStoreError("DECOMPOSITION_CONFLICT");
        for (const [position, task] of decomposition.tasks.entries()) {
          const taskInserted = await client.query(
            `INSERT INTO agent_world.mission_decomposition_tasks
               (decomposition_id, task_key, task_position, assignee_agent_id, task_id)
             SELECT $1, $2, $3, membership.agent_id, $5
               FROM agent_world.mission_decompositions decomposition
               JOIN agent_world.project_agents membership
                 ON membership.project_id = decomposition.project_id
                AND membership.agent_id = $4
              WHERE decomposition.id = $1
             RETURNING decomposition_id`,
            [decomposition.id, task.key, position, task.assigneeAgentId, task.taskId],
          );
          if (taskInserted.rows.length !== 1) {
            throw new MissionStoreError("DECOMPOSITION_CONFLICT");
          }
        }
        for (const task of decomposition.tasks) {
          for (const dependency of task.dependsOn) {
            await client.query(
              `INSERT INTO agent_world.mission_decomposition_dependencies
                 (decomposition_id, task_key, depends_on_task_key)
               VALUES ($1, $2, $3)`,
              [decomposition.id, task.key, dependency],
            );
          }
        }
        await this.appendCollaborationEvent(client, {
          eventType: "MISSION_DECOMPOSED",
          missionId: decomposition.missionId,
          decompositionId: decomposition.id,
          payloadHash,
          occurredAt: decomposition.createdAt,
        });
      },
    );
  }

  async recordMeeting(input: unknown) {
    const meeting: StructuredMeeting = StructuredMeetingSchema.parse(input);
    return this.persistCollaboration(
      "MEETING_CONFLICT",
      meeting.id,
      meeting,
      async (client, payloadHash) => {
        const inserted = await client.query(
          `INSERT INTO agent_world.structured_meetings
             (id, mission_id, project_id, topic, synthesis, decision,
              payload, payload_sha256, decided_at)
           SELECT $1, mission.id, mission.project_id, $4, $5, $6, $7::jsonb, $8, $9
             FROM agent_world.missions mission
            WHERE mission.id = $2 AND mission.project_id = $3
           RETURNING id`,
          [
            meeting.id,
            meeting.missionId,
            meeting.projectId,
            meeting.topic,
            meeting.synthesis,
            meeting.decision,
            JSON.stringify(meeting),
            payloadHash,
            meeting.decidedAt,
          ],
        );
        if (inserted.rows.length !== 1) throw new MissionStoreError("MEETING_CONFLICT");
        for (const [position, value] of meeting.positions.entries()) {
          const positionInserted = await client.query(
            `INSERT INTO agent_world.structured_meeting_agents
               (meeting_id, agent_id, position_index)
             SELECT $1, membership.agent_id, $3
               FROM agent_world.structured_meetings meeting
               JOIN agent_world.project_agents membership
                 ON membership.project_id = meeting.project_id
                AND membership.agent_id = $2
              WHERE meeting.id = $1
             RETURNING meeting_id`,
            [meeting.id, value.agentId, position],
          );
          if (positionInserted.rows.length !== 1) {
            throw new MissionStoreError("MEETING_CONFLICT");
          }
        }
        for (const eventId of meeting.sourceEventIds) {
          const sourceInserted = await client.query(
            `INSERT INTO agent_world.structured_meeting_sources (meeting_id, event_id)
             SELECT $1, event.id
               FROM agent_world.structured_meetings meeting
               JOIN agent_world.world_events event ON event.id = $2
               JOIN agent_world.project_agents membership
                 ON membership.project_id = meeting.project_id
                AND membership.agent_id = event.agent_id
              WHERE meeting.id = $1
             RETURNING meeting_id`,
            [meeting.id, eventId],
          );
          if (sourceInserted.rows.length !== 1) {
            throw new MissionStoreError("MEETING_CONFLICT");
          }
        }
        for (const [position, assessment] of meeting.criterionAssessments.entries()) {
          const assessed = await client.query(
            `INSERT INTO agent_world.structured_meeting_criterion_assessments
               (meeting_id, criterion_id, assessment_position, status, evidence_refs)
             SELECT $1, criterion.id, $3, $4, $5::jsonb
               FROM agent_world.structured_meetings meeting
               JOIN agent_world.mission_success_criteria criterion
                 ON criterion.mission_id = meeting.mission_id
                AND criterion.id = $2
              WHERE meeting.id = $1
             RETURNING criterion_id`,
            [
              meeting.id,
              assessment.criterionId,
              position,
              assessment.status,
              JSON.stringify(assessment.evidenceRefs),
            ],
          );
          if (assessed.rows.length !== 1) throw new MissionStoreError("MEETING_CONFLICT");
          const updated = await client.query(
            `UPDATE agent_world.mission_success_criteria
                SET status = $3, evidence_refs = $4::jsonb
              WHERE id = $1 AND mission_id = $2
            RETURNING id`,
            [
              assessment.criterionId,
              meeting.missionId,
              assessment.status,
              JSON.stringify(assessment.evidenceRefs),
            ],
          );
          if (updated.rows.length !== 1) throw new MissionStoreError("MEETING_CONFLICT");
        }
        await this.appendCollaborationEvent(client, {
          eventType: "MEETING_DECIDED",
          missionId: meeting.missionId,
          meetingId: meeting.id,
          payloadHash,
          occurredAt: meeting.decidedAt,
        });
      },
    );
  }

  async materializeDecomposition(decompositionIdInput: unknown, materializedAtInput: unknown) {
    const decompositionId = MissionDecompositionIdSchema.parse(decompositionIdInput);
    const materializedAt = TimestampSchema.parse(materializedAtInput);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:mission_materialization:${decompositionId}`,
      ]);
      const found = await client.query<
        QueryResultRow & { payload: unknown; materialized_at: Date | string | null }
      >(
        `SELECT decomposition.payload, decomposition.materialized_at
           FROM agent_world.mission_decompositions decomposition
           JOIN agent_world.missions mission ON mission.id = decomposition.mission_id
          WHERE decomposition.id = $1 AND mission.status = 'ACTIVE'
          FOR UPDATE OF decomposition`,
        [decompositionId],
      );
      const row = found.rows[0];
      if (!row || found.rows.length !== 1) {
        throw new MissionStoreError("MATERIALIZATION_CONFLICT");
      }
      const decomposition = MissionDecompositionSchema.parse(row.payload);
      if (row.materialized_at !== null) {
        await client.query("COMMIT");
        return {
          outcome: "REPLAY" as const,
          missionId: decomposition.missionId,
          taskIds: decomposition.tasks.map(({ taskId }) => taskId),
        };
      }
      if (Date.parse(materializedAt) < Date.parse(decomposition.createdAt)) {
        throw new MissionStoreError("MATERIALIZATION_CONFLICT");
      }
      const taskByKey = new Map(decomposition.tasks.map((task) => [task.key, task]));
      for (const taskProposal of decomposition.tasks) {
        const idempotencyKey = IdempotencyKeySchema.parse(
          `mission-task:${taskProposal.taskId.slice("task_".length)}`,
        );
        const inserted = await client.query(
          `INSERT INTO agent_world.tasks
             (id, conversation_id, project_id, mission_id, assignee_agent_id,
              title, description, approval_requirement, idempotency_key, created_at)
           SELECT $1, NULL, $2, $3, membership.agent_id, $5, $6, 'REQUIRED', $7, $8
             FROM agent_world.project_agents membership
            WHERE membership.project_id = $2 AND membership.agent_id = $4
           RETURNING id`,
          [
            taskProposal.taskId,
            decomposition.projectId,
            decomposition.missionId,
            taskProposal.assigneeAgentId,
            taskProposal.title,
            taskProposal.description ?? null,
            idempotencyKey,
            materializedAt,
          ],
        );
        if (inserted.rows.length !== 1) {
          throw new MissionStoreError("MATERIALIZATION_CONFLICT");
        }
        const approvalId = ApprovalIdSchema.parse(
          `approval_${taskProposal.taskId.slice("task_".length)}`,
        );
        const expiresAt = new Date(Date.parse(materializedAt) + 15 * 60 * 1_000).toISOString();
        await client.query(
          `INSERT INTO agent_world.approvals
             (id, task_id, state, requested_at, expires_at)
           VALUES ($1, $2, 'PENDING', $3, $4)`,
          [approvalId, taskProposal.taskId, materializedAt, expiresAt],
        );
        await this.appendWorldTaskEvent(client, {
          eventType: "TASK_ASSIGNED",
          occurredAt: materializedAt,
          commandId: idempotencyKey,
          agentId: taskProposal.assigneeAgentId,
          taskId: taskProposal.taskId,
        });
        if (taskProposal.dependsOn.length === 0) {
          await this.appendWorldTaskEvent(client, {
            eventType: "APPROVAL_STATE_CHANGED",
            occurredAt: materializedAt,
            commandId: idempotencyKey,
            agentId: taskProposal.assigneeAgentId,
            taskId: taskProposal.taskId,
            approvalId,
            expiresAt,
          });
        }
      }
      for (const taskProposal of decomposition.tasks) {
        for (const dependencyKey of taskProposal.dependsOn) {
          const dependency = taskByKey.get(dependencyKey);
          if (!dependency) throw new MissionStoreError("MATERIALIZATION_CONFLICT");
          await client.query(
            `INSERT INTO agent_world.mission_task_dependencies
               (mission_id, task_id, depends_on_task_id)
             VALUES ($1, $2, $3)`,
            [decomposition.missionId, taskProposal.taskId, dependency.taskId],
          );
        }
      }
      const updated = await client.query(
        `UPDATE agent_world.mission_decompositions
            SET materialized_at = $2
          WHERE id = $1 AND materialized_at IS NULL
        RETURNING id`,
        [decompositionId, materializedAt],
      );
      if (updated.rows.length !== 1) throw new MissionStoreError("MATERIALIZATION_CONFLICT");
      await client.query("COMMIT");
      return {
        outcome: "CREATED" as const,
        missionId: decomposition.missionId,
        taskIds: decomposition.tasks.map(({ taskId }) => taskId),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendWorldTaskEvent(
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
      throw new MissionStoreError("MATERIALIZATION_CONFLICT");
    }
    const eventId = EventIdSchema.parse(
      this.identities.eventId?.() ??
        (() => {
          throw new Error("A production Mission collaboration Event identity is required");
        })(),
    );
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

  private async persistCollaboration(
    conflict: "DECOMPOSITION_CONFLICT" | "MEETING_CONFLICT",
    id: string,
    payload: MissionDecomposition | StructuredMeeting,
    insert: (
      client: Awaited<ReturnType<TransactionPool["connect"]>>,
      hash: string,
    ) => Promise<void>,
  ) {
    const payloadHash = sha256(payload);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:mission_collaboration:${id}`,
      ]);
      const table =
        conflict === "DECOMPOSITION_CONFLICT" ? "mission_decompositions" : "structured_meetings";
      const existing = await client.query(
        `SELECT payload_sha256 FROM agent_world.${table} WHERE id = $1`,
        [id],
      );
      if (existing.rows[0]) {
        if (existing.rows.length !== 1 || existing.rows[0].payload_sha256 !== payloadHash) {
          throw new MissionStoreError(conflict);
        }
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, payload };
      }
      await insert(client, payloadHash);
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, payload };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendCollaborationEvent(
    client: Awaited<ReturnType<TransactionPool["connect"]>>,
    input:
      | {
          eventType: "MISSION_DECOMPOSED";
          missionId: string;
          decompositionId: string;
          payloadHash: string;
          occurredAt: string;
        }
      | {
          eventType: "MEETING_DECIDED";
          missionId: string;
          meetingId: string;
          payloadHash: string;
          occurredAt: string;
        },
  ) {
    const eventId = EventIdSchema.parse(
      this.identities.eventId?.() ??
        (() => {
          throw new Error("A production Mission collaboration Event identity is required");
        })(),
    );
    await client.query(
      `INSERT INTO agent_world.mission_collaboration_events
         (id, event_type, mission_id, decomposition_id, meeting_id,
          payload_sha256, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        eventId,
        input.eventType,
        input.missionId,
        "decompositionId" in input ? input.decompositionId : null,
        "meetingId" in input ? input.meetingId : null,
        input.payloadHash,
        input.occurredAt,
      ],
    );
  }
}
