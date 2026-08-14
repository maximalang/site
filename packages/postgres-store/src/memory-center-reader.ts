import {
  MemoryInboxSchema,
  MemoryNetworkSchema,
  MemoryTimelineSchema,
  ProjectIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";

type QueryPool = {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
};

type ProposalRow = QueryResultRow & {
  id: string;
  project_id: string;
  source_context_item_id: string;
  content: string;
  content_sha256: string;
  estimated_tokens: number;
  importance: number;
  status: string;
  created_at: Date | string;
};

type TimelineRow = QueryResultRow & {
  decision_id: string;
  proposal_id: string;
  action: string;
  source_context_item_id: string;
  materialized_context_item_id: string | null;
  content: string;
  decided_at: Date | string;
};

type NodeRow = QueryResultRow & {
  context_item_id: string;
  source_context_item_id: string;
  content: string;
  importance: number;
  created_at: Date | string;
};

type EdgeRow = QueryResultRow & {
  decision_id: string;
  source_context_item_id: string;
  target_context_item_id: string;
  relation: string;
  created_at: Date | string;
};

function iso(value: Date | string): string {
  return TimestampSchema.parse(value instanceof Date ? value.toISOString() : value);
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Memory Center limit must be an integer between 1 and 500");
  }
  return limit;
}

export class PostgresMemoryCenterReader {
  constructor(private readonly pool: QueryPool) {}

  async inbox(projectIdValue: unknown, limitValue = 100) {
    const projectId = ProjectIdSchema.parse(projectIdValue);
    const limit = boundedLimit(limitValue);
    const result = await this.pool.query<ProposalRow>(
      `SELECT proposal.id, proposal.project_id, proposal.source_context_item_id,
              proposal.content, proposal.content_sha256, proposal.estimated_tokens,
              proposal.importance, proposal.status, proposal.created_at
         FROM agent_world.memory_proposals proposal
        WHERE proposal.status = 'PENDING' AND proposal.project_id = $1
        ORDER BY proposal.created_at DESC, proposal.id
        LIMIT $2`,
      [projectId, limit],
    );
    return MemoryInboxSchema.parse({
      schemaVersion: 1,
      projectId,
      proposals: result.rows.map((row) => ({
        schemaVersion: 1,
        id: row.id,
        projectId: row.project_id,
        sourceContextItemId: row.source_context_item_id,
        content: row.content,
        contentHash: row.content_sha256,
        estimatedTokens: row.estimated_tokens,
        importance: row.importance,
        status: row.status,
        createdAt: iso(row.created_at),
      })),
    });
  }

  async timeline(projectIdValue: unknown, limitValue = 100) {
    const projectId = ProjectIdSchema.parse(projectIdValue);
    const limit = boundedLimit(limitValue);
    const result = await this.pool.query<TimelineRow>(
      `/* MEMORY_TIMELINE */
       SELECT decision.id AS decision_id, decision.proposal_id, decision.action,
              proposal.source_context_item_id, decision.materialized_context_item_id,
              proposal.content, decision.decided_at
         FROM agent_world.memory_curation_decisions decision
         JOIN agent_world.memory_proposals proposal
           ON proposal.id = decision.proposal_id AND proposal.project_id = decision.project_id
        WHERE decision.project_id = $1
        ORDER BY decision.decided_at DESC, decision.id
        LIMIT $2`,
      [projectId, limit],
    );
    return MemoryTimelineSchema.parse({
      schemaVersion: 1,
      projectId,
      entries: result.rows.map((row) => ({
        decisionId: row.decision_id,
        proposalId: row.proposal_id,
        action: row.action,
        sourceContextItemId: row.source_context_item_id,
        ...(row.materialized_context_item_id === null
          ? {}
          : { materializedContextItemId: row.materialized_context_item_id }),
        content: row.content,
        decidedAt: iso(row.decided_at),
      })),
    });
  }

  async network(projectIdValue: unknown, limitValue = 100) {
    const projectId = ProjectIdSchema.parse(projectIdValue);
    const limit = boundedLimit(limitValue);
    const [nodes, edges] = await Promise.all([
      this.pool.query<NodeRow>(
        `/* MEMORY_NETWORK_NODES */
         SELECT memory.id AS context_item_id, proposal.source_context_item_id,
                memory.content, memory.importance, memory.created_at
           FROM agent_world.memory_curation_decisions decision
           JOIN agent_world.memory_proposals proposal
             ON proposal.id = decision.proposal_id AND proposal.project_id = decision.project_id
           JOIN agent_world.context_items memory
             ON memory.id = decision.materialized_context_item_id
            AND memory.project_id = decision.project_id AND memory.kind = 'MEMORY'
          WHERE decision.project_id = $1 AND decision.action = 'ACCEPT'
          ORDER BY memory.importance DESC, memory.created_at DESC, memory.id
          LIMIT $2`,
        [projectId, limit],
      ),
      this.pool.query<EdgeRow>(
        `/* MEMORY_NETWORK_EDGES */
         SELECT decision.id AS decision_id, proposal.source_context_item_id,
                decision.materialized_context_item_id AS target_context_item_id,
                CASE WHEN decision.action = 'ACCEPT'
                     THEN 'ACCEPTED_FROM' ELSE 'MERGED_INTO' END AS relation,
                decision.decided_at AS created_at
           FROM agent_world.memory_curation_decisions decision
           JOIN agent_world.memory_proposals proposal
             ON proposal.id = decision.proposal_id AND proposal.project_id = decision.project_id
          WHERE decision.project_id = $1
            AND decision.action IN ('ACCEPT', 'MERGE')
          ORDER BY decision.decided_at DESC, decision.id
          LIMIT $2`,
        [projectId, Math.min(limit * 2, 500)],
      ),
    ]);
    return MemoryNetworkSchema.parse({
      schemaVersion: 1,
      projectId,
      nodes: nodes.rows.map((row) => ({
        contextItemId: row.context_item_id,
        sourceContextItemId: row.source_context_item_id,
        content: row.content,
        importance: row.importance,
        createdAt: iso(row.created_at),
      })),
      edges: edges.rows.map((row) => ({
        decisionId: row.decision_id,
        sourceContextItemId: row.source_context_item_id,
        targetContextItemId: row.target_context_item_id,
        relation: row.relation,
        createdAt: iso(row.created_at),
      })),
    });
  }
}
