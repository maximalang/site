import { createHash } from "node:crypto";
import {
  type ContextPack,
  ContextPackSchema,
  RunIdSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type ExistingRow = QueryResultRow & { id: string; pack_sha256: string };
type PackRow = QueryResultRow & {
  id: string;
  run_id: string;
  task_id: string;
  agent_id: string;
  project_id: string;
  route_id: string;
  compiler_version: string;
  token_budget: number;
  estimated_tokens: number;
  content_sha256: string;
  sections: unknown;
  rendered: string;
  compiled_at: Date | string;
};
type EvidenceRow = QueryResultRow & {
  context_item_id: string;
  section: string;
  content_sha256: string;
  score: number;
  provenance: unknown;
};

export type ContextPackStoreErrorCode = "IDEMPOTENCY_CONFLICT" | "NOT_FOUND" | "PERSISTENCE_FAILED";

export class ContextPackStoreError extends Error {
  constructor(readonly code: ContextPackStoreErrorCode) {
    super(code);
    this.name = "ContextPackStoreError";
  }
}

export class PostgresContextPackStore {
  constructor(private readonly pool: TransactionPool) {}

  static fingerprint(packValue: unknown): string {
    const pack = ContextPackSchema.parse(packValue);
    return createHash("sha256").update(JSON.stringify(pack), "utf8").digest("hex");
  }

  async readByRun(runIdValue: unknown): Promise<ContextPack> {
    const runId = RunIdSchema.parse(runIdValue);
    const client = await this.pool.connect();
    try {
      const packResult = await client.query<PackRow>(
        `SELECT id, run_id, task_id, agent_id, project_id, route_id,
                compiler_version, token_budget, estimated_tokens, content_sha256,
                sections, rendered, compiled_at
           FROM agent_world.context_packs
          WHERE run_id = $1`,
        [runId],
      );
      const row = packResult.rows[0];
      if (!row) throw new ContextPackStoreError("NOT_FOUND");
      const evidenceResult = await client.query<EvidenceRow>(
        `SELECT context_item_id, section, content_sha256, score, provenance
           FROM agent_world.context_pack_evidence
          WHERE context_pack_id = $1
          ORDER BY ordinal`,
        [row.id],
      );
      return ContextPackSchema.parse({
        schemaVersion: 1,
        compilerVersion: row.compiler_version,
        id: row.id,
        runId: row.run_id,
        taskId: row.task_id,
        agentId: row.agent_id,
        projectId: row.project_id,
        routeId: row.route_id,
        tokenBudget: row.token_budget,
        estimatedTokens: row.estimated_tokens,
        contentHash: row.content_sha256,
        compiledAt: TimestampSchema.parse(
          row.compiled_at instanceof Date ? row.compiled_at.toISOString() : row.compiled_at,
        ),
        sections: row.sections,
        rendered: row.rendered,
        evidence: evidenceResult.rows.map((evidence) => ({
          contextItemId: evidence.context_item_id,
          section: evidence.section,
          contentHash: evidence.content_sha256,
          score: evidence.score,
          provenance: evidence.provenance,
        })),
      });
    } finally {
      client.release();
    }
  }

  async persist(packValue: unknown): Promise<{
    outcome: "CREATED" | "REPLAY";
    contextPackId: ContextPack["id"];
  }> {
    const pack = ContextPackSchema.parse(packValue);
    const fingerprint = PostgresContextPackStore.fingerprint(pack);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `agent_world:context_pack:${pack.runId}`,
      ]);
      const existing = await client.query<ExistingRow>(
        `SELECT id, pack_sha256
           FROM agent_world.context_packs
          WHERE run_id = $1 OR id = $2
          FOR UPDATE`,
        [pack.runId, pack.id],
      );
      if (existing.rows.length > 1 || existing.rows[0]?.pack_sha256 !== fingerprint) {
        if (existing.rows.length > 0) throw new ContextPackStoreError("IDEMPOTENCY_CONFLICT");
      }
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return { outcome: "REPLAY", contextPackId: pack.id };
      }
      await client.query(
        `INSERT INTO agent_world.context_packs
           (id, run_id, task_id, agent_id, project_id, route_id, compiler_version,
            token_budget, estimated_tokens, content_sha256, pack_sha256, sections,
            rendered, compiled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
        [
          pack.id,
          pack.runId,
          pack.taskId,
          pack.agentId,
          pack.projectId,
          pack.routeId,
          pack.compilerVersion,
          pack.tokenBudget,
          pack.estimatedTokens,
          pack.contentHash,
          fingerprint,
          JSON.stringify(pack.sections),
          pack.rendered,
          pack.compiledAt,
        ],
      );
      for (const [ordinal, evidence] of pack.evidence.entries()) {
        await client.query(
          `INSERT INTO agent_world.context_pack_evidence
             (context_pack_id, project_id, ordinal, context_item_id, section,
              content_sha256, score, provenance)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            pack.id,
            pack.projectId,
            ordinal,
            evidence.contextItemId,
            evidence.section,
            evidence.contentHash,
            evidence.score,
            JSON.stringify(evidence.provenance),
          ],
        );
      }
      await client.query("COMMIT");
      return { outcome: "CREATED", contextPackId: pack.id };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof ContextPackStoreError) throw error;
      throw new ContextPackStoreError("PERSISTENCE_FAILED");
    } finally {
      client.release();
    }
  }
}
