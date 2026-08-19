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

type CandidateRow = QueryResultRow & {
  proposal_id: string;
  context_item_id: string;
  content: string;
  importance: number;
  created_at: Date | string;
};

type TimelineRow = QueryResultRow & {
  decision_id: string;
  proposal_id: string;
  action: string;
  source_context_item_id: string;
  target_context_item_id: string | null;
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
    const proposalIds = result.rows.map((row) => row.id);
    const candidates =
      proposalIds.length === 0
        ? { rows: [] as CandidateRow[] }
        : await this.pool.query<CandidateRow>(
            `/* MEMORY_INBOX_CANDIDATES */
             SELECT proposal.id AS proposal_id, memory.id AS context_item_id,
                    memory.content, memory.importance, memory.created_at
               FROM agent_world.memory_proposals proposal
               JOIN LATERAL (
                 SELECT item.id, item.content, item.importance, item.created_at
                   FROM agent_world.context_items item
                  WHERE item.project_id = proposal.project_id
                    AND item.kind = 'MEMORY'
                    AND item.content_sha256 = proposal.content_sha256
                    AND item.created_at < CURRENT_TIMESTAMP
                    AND (item.valid_until IS NULL OR item.valid_until > CURRENT_TIMESTAMP)
                  ORDER BY item.importance DESC, item.created_at DESC, item.id
                  LIMIT 5
               ) memory ON TRUE
              WHERE proposal.project_id = $1
                AND proposal.status = 'PENDING'
                AND proposal.id = ANY($2::text[])
              ORDER BY proposal.id, memory.importance DESC, memory.created_at DESC,
                       memory.context_item_id`,
            [projectId, proposalIds],
          );
    const candidatesByProposal = new Map<string, CandidateRow[]>();
    for (const candidate of candidates.rows) {
      const entries = candidatesByProposal.get(candidate.proposal_id) ?? [];
      entries.push(candidate);
      candidatesByProposal.set(candidate.proposal_id, entries);
    }
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
        curationCandidates: (candidatesByProposal.get(row.id) ?? []).map((candidate) => ({
          contextItemId: candidate.context_item_id,
          matchKind: "EXACT_CONTENT" as const,
          suggestedAction: "MERGE" as const,
          content: candidate.content,
          importance: candidate.importance,
          createdAt: iso(candidate.created_at),
        })),
      })),
    });
  }

  async timeline(projectIdValue: unknown, limitValue = 100) {
    const projectId = ProjectIdSchema.parse(projectIdValue);
    const limit = boundedLimit(limitValue);
    const result = await this.pool.query<TimelineRow>(
      `/* MEMORY_TIMELINE */
       SELECT decision.id AS decision_id, decision.proposal_id, decision.action,
              proposal.source_context_item_id, decision.target_context_item_id,
              decision.materialized_context_item_id, proposal.content, decision.decided_at
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
        ...(row.target_context_item_id === null
          ? {}
          : { targetContextItemId: row.target_context_item_id }),
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
          WHERE decision.project_id = $1 AND decision.action IN ('ACCEPT', 'SUPERSEDE')
          ORDER BY memory.importance DESC, memory.created_at DESC, memory.id
          LIMIT $2`,
        [projectId, limit],
      ),
      this.pool.query<EdgeRow>(
        `/* MEMORY_NETWORK_EDGES */
         SELECT decision.id AS decision_id,
                CASE WHEN decision.action = 'SUPERSEDE'
                     THEN decision.materialized_context_item_id
                     ELSE proposal.source_context_item_id END AS source_context_item_id,
                CASE WHEN decision.action = 'SUPERSEDE'
                     THEN decision.target_context_item_id
                     ELSE decision.materialized_context_item_id END AS target_context_item_id,
                CASE WHEN decision.action = 'ACCEPT' THEN 'ACCEPTED_FROM'
                     WHEN decision.action = 'MERGE' THEN 'MERGED_INTO'
                     ELSE 'SUPERSEDES' END AS relation,
                decision.decided_at AS created_at
           FROM agent_world.memory_curation_decisions decision
           JOIN agent_world.memory_proposals proposal
             ON proposal.id = decision.proposal_id AND proposal.project_id = decision.project_id
          WHERE decision.project_id = $1
            AND decision.action IN ('ACCEPT', 'MERGE', 'SUPERSEDE')
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
