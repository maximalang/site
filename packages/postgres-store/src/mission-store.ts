import {
  type AgentInstanceAssignment,
  AgentInstanceAssignmentSchema,
  type AgentTemplate,
  AgentTemplateSchema,
  type Mission,
  MissionSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

export type MissionStoreErrorCode =
  | "MISSION_CONFLICT"
  | "TEMPLATE_CONFLICT"
  | "ASSIGNMENT_CONFLICT";

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

type MissionRow = QueryResultRow & {
  id: string;
  project_id: string;
  title: string;
  goal: string;
  status: string;
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

function missionFromRow(row: MissionRow): Mission {
  return MissionSchema.parse({
    schemaVersion: 1,
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
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

const SELECT_MISSION = `SELECT m.id, m.project_id, m.title, m.goal, m.status,
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
  constructor(private readonly pool: TransactionPool) {}

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
           (id, project_id, title, goal, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          mission.id,
          mission.projectId,
          mission.title,
          mission.goal,
          mission.status,
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
}
