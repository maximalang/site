import { createHash } from "node:crypto";
import {
  EventIdSchema,
  type MemoryCurationDecision,
  MemoryCurationDecisionSchema,
  type MemoryProposal,
  MemoryProposalSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type ProposalRow = QueryResultRow & {
  id: string;
  project_id: string;
  source_context_item_id: string;
  content: string;
  content_sha256: string;
  estimated_tokens: number;
  importance: number;
  status: string;
  request_sha256?: string;
};

type DecisionRow = QueryResultRow & {
  id: string;
  proposal_id: string;
  project_id: string;
  action: MemoryCurationDecision["action"];
  target_context_item_id: string | null;
  materialized_context_item_id: string | null;
  idempotency_key: string;
  request_sha256: string;
};

type TargetRow = QueryResultRow & {
  id: string;
  created_at: Date | string;
  valid_until: Date | string | null;
};

type MergeTargetRow = TargetRow & {
  content: string;
  content_sha256: string;
  shares_source_provenance: boolean;
};

export type MemoryProposalReceipt = {
  outcome: "CREATED" | "DEDUPLICATED";
  proposalId: string;
};

export type MemoryDecisionReceipt = {
  outcome: "CREATED" | "REPLAYED";
  proposalId: string;
  status: "ACCEPTED" | "MERGED" | "SUPERSEDED" | "REJECTED";
  materializedContextItemId?: string;
};

export type MemoryCurationStoreErrorCode =
  | "SOURCE_NOT_FOUND"
  | "PROPOSAL_CONFLICT"
  | "PROPOSAL_NOT_FOUND"
  | "DECISION_CONFLICT"
  | "TARGET_NOT_FOUND"
  | "TARGET_NOT_ACTIVE"
  | "TARGET_RELATION_MISMATCH";

export class MemoryCurationStoreError extends Error {
  constructor(readonly code: MemoryCurationStoreErrorCode) {
    super(code);
    this.name = "MemoryCurationStoreError";
  }
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function contentSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function statusFor(action: MemoryCurationDecision["action"]): MemoryDecisionReceipt["status"] {
  if (action === "ACCEPT") return "ACCEPTED";
  if (action === "MERGE") return "MERGED";
  if (action === "SUPERSEDE") return "SUPERSEDED";
  return "REJECTED";
}

function receiptFromDecision(row: DecisionRow, outcome: "CREATED" | "REPLAYED") {
  return {
    outcome,
    proposalId: row.proposal_id,
    status: statusFor(row.action),
    ...(row.materialized_context_item_id === null
      ? {}
      : { materializedContextItemId: row.materialized_context_item_id }),
  } satisfies MemoryDecisionReceipt;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

export class PostgresMemoryCurationStore {
  constructor(
    private readonly pool: TransactionPool,
    private readonly identities: { contextItemId?: () => string; eventId?: () => string } = {},
  ) {}

  async propose(value: unknown): Promise<MemoryProposalReceipt> {
    const proposal: MemoryProposal = MemoryProposalSchema.parse(value);
    if (proposal.status !== "PENDING") throw new MemoryCurationStoreError("PROPOSAL_CONFLICT");
    const canonicalProposal: MemoryProposal = {
      ...proposal,
      contentHash: contentSha256(proposal.content),
    };
    const { id: _requestedId, ...canonicalRequest } = canonicalProposal;
    const requestHash = sha256(canonicalRequest);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:memory_proposal:${proposal.id}`,
      ]);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO agent_world.memory_proposals
           (id, project_id, source_context_item_id, content, content_sha256,
            estimated_tokens, importance, status, request_sha256, created_at)
         SELECT $1, $2, source.id, $4, $5, $6, $7, 'PENDING', $8, $9
           FROM agent_world.context_items source
          WHERE source.id = $3 AND source.project_id = $2
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          canonicalProposal.id,
          canonicalProposal.projectId,
          canonicalProposal.sourceContextItemId,
          canonicalProposal.content,
          canonicalProposal.contentHash,
          canonicalProposal.estimatedTokens,
          canonicalProposal.importance,
          requestHash,
          canonicalProposal.createdAt,
        ],
      );
      if (inserted.rows[0]) {
        const eventId = EventIdSchema.parse(
          this.identities.eventId?.() ??
            (() => {
              throw new Error("A production memory Event identity is required");
            })(),
        );
        await client.query(
          `INSERT INTO agent_world.memory_events
             (id, event_type, project_id, proposal_id, source_context_item_id,
              content, payload_sha256, occurred_at)
           VALUES ($1, 'MEMORY_PROPOSED', $2, $3, $4, $5, $6, $7)`,
          [
            eventId,
            canonicalProposal.projectId,
            canonicalProposal.id,
            canonicalProposal.sourceContextItemId,
            canonicalProposal.content,
            sha256({ eventType: "MEMORY_PROPOSED", proposal: canonicalProposal }),
            canonicalProposal.createdAt,
          ],
        );
        await client.query("COMMIT");
        return { outcome: "CREATED", proposalId: inserted.rows[0].id };
      }
      const existing = await client.query<ProposalRow>(
        `SELECT id, project_id, source_context_item_id, content_sha256, request_sha256
           FROM agent_world.memory_proposals
          WHERE id = $1 OR
                (project_id = $2 AND source_context_item_id = $3 AND content_sha256 = $4)`,
        [
          canonicalProposal.id,
          canonicalProposal.projectId,
          canonicalProposal.sourceContextItemId,
          canonicalProposal.contentHash,
        ],
      );
      if (existing.rows.length === 1 && existing.rows[0]?.request_sha256 === requestHash) {
        await client.query("COMMIT");
        return { outcome: "DEDUPLICATED", proposalId: existing.rows[0].id };
      }
      const source = await client.query(
        "SELECT 1 FROM agent_world.context_items WHERE id = $1 AND project_id = $2",
        [canonicalProposal.sourceContextItemId, canonicalProposal.projectId],
      );
      if (source.rows.length === 0) throw new MemoryCurationStoreError("SOURCE_NOT_FOUND");
      throw new MemoryCurationStoreError("PROPOSAL_CONFLICT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async decide(value: unknown): Promise<MemoryDecisionReceipt> {
    const decision = MemoryCurationDecisionSchema.parse(value);
    const requestHash = sha256(decision);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:memory_decision:${decision.proposalId}`,
      ]);
      const existing = await client.query<DecisionRow>(
        `SELECT id, proposal_id, project_id, action, target_context_item_id,
                materialized_context_item_id, idempotency_key, request_sha256
           FROM agent_world.memory_curation_decisions
          WHERE id = $1 OR proposal_id = $2 OR idempotency_key = $3`,
        [decision.id, decision.proposalId, decision.idempotencyKey],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (
          existing.rows.length !== 1 ||
          !row ||
          row.proposal_id !== decision.proposalId ||
          row.project_id !== decision.projectId ||
          row.request_sha256 !== requestHash
        ) {
          throw new MemoryCurationStoreError("DECISION_CONFLICT");
        }
        await client.query("COMMIT");
        return receiptFromDecision(row, "REPLAYED");
      }
      const proposalResult = await client.query<ProposalRow>(
        `SELECT id, project_id, source_context_item_id, content, content_sha256,
                estimated_tokens, importance, status
           FROM agent_world.memory_proposals
          WHERE id = $1 AND project_id = $2
          FOR UPDATE`,
        [decision.proposalId, decision.projectId],
      );
      const proposal = proposalResult.rows[0];
      if (!proposal) throw new MemoryCurationStoreError("PROPOSAL_NOT_FOUND");
      if (proposal.status !== "PENDING") throw new MemoryCurationStoreError("DECISION_CONFLICT");

      let materializedContextItemId: string | null = null;
      let targetContextItemId: string | null = null;
      if (decision.action === "MERGE") {
        const target = await client.query<MergeTargetRow>(
          `SELECT target.id, target.content, target.content_sha256,
                  target.created_at, target.valid_until,
                  (target.provenance_kind = source.provenance_kind
                   AND target.event_id IS NOT DISTINCT FROM source.event_id
                   AND target.message_id IS NOT DISTINCT FROM source.message_id
                   AND target.run_id IS NOT DISTINCT FROM source.run_id
                   AND target.artifact_id IS NOT DISTINCT FROM source.artifact_id
                   AND target.document_chunk_id IS NOT DISTINCT FROM source.document_chunk_id)
                    AS shares_source_provenance
             FROM agent_world.context_items target
             JOIN agent_world.context_items source
               ON source.id = $3 AND source.project_id = target.project_id
            WHERE target.id = $1 AND target.project_id = $2 AND target.kind = 'MEMORY'
            FOR SHARE OF target`,
          [decision.targetContextItemId, decision.projectId, proposal.source_context_item_id],
        );
        const targetRow = target.rows[0];
        if (!targetRow) throw new MemoryCurationStoreError("TARGET_NOT_FOUND");
        const decidedAt = Date.parse(decision.decidedAt);
        if (
          timestamp(targetRow.created_at) >= decidedAt ||
          (targetRow.valid_until !== null && timestamp(targetRow.valid_until) <= decidedAt)
        ) {
          throw new MemoryCurationStoreError("TARGET_NOT_ACTIVE");
        }
        const exactContent =
          targetRow.content_sha256 === proposal.content_sha256 &&
          targetRow.content === proposal.content;
        if (!exactContent && targetRow.shares_source_provenance !== true) {
          throw new MemoryCurationStoreError("TARGET_RELATION_MISMATCH");
        }
        targetContextItemId = targetRow.id;
        materializedContextItemId = targetRow.id;
      } else if (decision.action === "SUPERSEDE") {
        const target = await client.query<TargetRow>(
          `SELECT id, created_at, valid_until
             FROM agent_world.context_items
            WHERE id = $1 AND project_id = $2 AND kind = 'MEMORY'
            FOR UPDATE`,
          [decision.targetContextItemId, decision.projectId],
        );
        const targetRow = target.rows[0];
        if (!targetRow) throw new MemoryCurationStoreError("TARGET_NOT_FOUND");
        const decidedAt = Date.parse(decision.decidedAt);
        if (
          timestamp(targetRow.created_at) >= decidedAt ||
          (targetRow.valid_until !== null && timestamp(targetRow.valid_until) <= decidedAt)
        ) {
          throw new MemoryCurationStoreError("TARGET_NOT_ACTIVE");
        }
        targetContextItemId = targetRow.id;
      }

      if (decision.action === "ACCEPT" || decision.action === "SUPERSEDE") {
        const nextContextId = this.identities.contextItemId?.();
        if (!nextContextId) throw new Error("A production memory ContextItem identity is required");
        const materialized = await client.query<{ id: string }>(
          `WITH inserted AS (
             INSERT INTO agent_world.context_items
               (id, project_id, kind, temperature, content, content_sha256,
                estimated_tokens, importance, provenance_kind, event_id, message_id,
                run_id, artifact_id, document_chunk_id, agent_id, task_id, skill_id,
                created_at)
             SELECT $1, proposal.project_id, 'MEMORY', 'WARM', proposal.content,
                    proposal.content_sha256, proposal.estimated_tokens,
                    proposal.importance, source.provenance_kind, source.event_id,
                    source.message_id, source.run_id, source.artifact_id,
                    source.document_chunk_id, source.agent_id, source.task_id,
                    source.skill_id, $3
               FROM agent_world.memory_proposals proposal
               JOIN agent_world.context_items source
                 ON source.id = proposal.source_context_item_id
                AND source.project_id = proposal.project_id
              WHERE proposal.id = $2 AND proposal.project_id = $4
             ON CONFLICT DO NOTHING
             RETURNING id
           )
           SELECT id FROM inserted
           UNION ALL
           SELECT memory.id
             FROM agent_world.memory_proposals proposal
             JOIN agent_world.context_items source
               ON source.id = proposal.source_context_item_id
              AND source.project_id = proposal.project_id
             JOIN agent_world.context_items memory
               ON memory.project_id = proposal.project_id
              AND memory.kind = 'MEMORY'
              AND memory.content_sha256 = proposal.content_sha256
              AND memory.provenance_kind = source.provenance_kind
              AND memory.event_id IS NOT DISTINCT FROM source.event_id
              AND memory.message_id IS NOT DISTINCT FROM source.message_id
              AND memory.run_id IS NOT DISTINCT FROM source.run_id
              AND memory.artifact_id IS NOT DISTINCT FROM source.artifact_id
              AND memory.document_chunk_id IS NOT DISTINCT FROM source.document_chunk_id
            WHERE proposal.id = $2 AND proposal.project_id = $4
              AND NOT EXISTS (SELECT 1 FROM inserted)
           LIMIT 1`,
          [nextContextId, decision.proposalId, decision.decidedAt, decision.projectId],
        );
        materializedContextItemId = materialized.rows[0]?.id ?? null;
        if (!materializedContextItemId) throw new MemoryCurationStoreError("PROPOSAL_CONFLICT");
      }

      if (decision.action === "SUPERSEDE") {
        if (materializedContextItemId === targetContextItemId) {
          throw new MemoryCurationStoreError("PROPOSAL_CONFLICT");
        }
        const expired = await client.query<{ id: string }>(
          `UPDATE agent_world.context_items
              SET valid_until = $3
            WHERE id = $1 AND project_id = $2 AND kind = 'MEMORY'
              AND created_at < $3
              AND (valid_until IS NULL OR valid_until > $3)
            RETURNING id`,
          [targetContextItemId, decision.projectId, decision.decidedAt],
        );
        if (!expired.rows[0]) throw new MemoryCurationStoreError("TARGET_NOT_ACTIVE");
      }

      const status = statusFor(decision.action);
      await client.query(
        `INSERT INTO agent_world.memory_curation_decisions
           (id, proposal_id, project_id, action, target_context_item_id,
            materialized_context_item_id, idempotency_key, request_sha256, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          decision.id,
          decision.proposalId,
          decision.projectId,
          decision.action,
          targetContextItemId,
          materializedContextItemId,
          decision.idempotencyKey,
          requestHash,
          decision.decidedAt,
        ],
      );
      await client.query(
        `UPDATE agent_world.memory_proposals
            SET status = $3, decided_at = $4
          WHERE id = $1 AND project_id = $2 AND status = 'PENDING'`,
        [decision.proposalId, decision.projectId, status, decision.decidedAt],
      );
      const eventId = EventIdSchema.parse(
        this.identities.eventId?.() ??
          (() => {
            throw new Error("A production memory Event identity is required");
          })(),
      );
      await client.query(
        `INSERT INTO agent_world.memory_events
           (id, event_type, project_id, proposal_id, decision_id,
            source_context_item_id, target_context_item_id, materialized_context_item_id, action,
            content, payload_sha256, occurred_at)
         VALUES ($1, 'MEMORY_CURATED', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          eventId,
          decision.projectId,
          decision.proposalId,
          decision.id,
          proposal.source_context_item_id,
          targetContextItemId,
          materializedContextItemId,
          decision.action,
          proposal.content,
          sha256({
            eventType: "MEMORY_CURATED",
            decision,
            sourceContextItemId: proposal.source_context_item_id,
            targetContextItemId,
            materializedContextItemId,
          }),
          decision.decidedAt,
        ],
      );
      await client.query("COMMIT");
      return {
        outcome: "CREATED",
        proposalId: decision.proposalId,
        status,
        ...(materializedContextItemId === null ? {} : { materializedContextItemId }),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
