import { AccountIdSchema, TimestampSchema } from "@agent-world/domain";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const WorkerIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => [...value].every((character) => (character.codePointAt(0) ?? 0) > 31));

const ReportSchema = z.strictObject({
  workerId: WorkerIdSchema,
  accountId: AccountIdSchema,
  authentication: z.enum(["CHATGPT", "UNAVAILABLE"]),
  checkedAt: TimestampSchema,
});

export class PostgresCodexWorkerReadinessStore {
  constructor(private readonly pool: TransactionPool) {}

  async report(inputValue: unknown) {
    const input = ReportSchema.parse(inputValue);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ id: string }>(
        `SELECT a.id
           FROM agent_world.accounts a
           JOIN agent_world.account_surfaces surface
             ON surface.account_id = a.id AND surface.surface = 'CODEX'
          WHERE a.id = $1
            AND a.auth_mechanism = 'CHATGPT_INTERACTIVE'
            AND a.is_enabled = true
          FOR UPDATE OF a`,
        [input.accountId],
      );
      if (account.rows.length !== 1) throw new Error("CODEX_ACCOUNT_UNAVAILABLE");
      await client.query(
        `INSERT INTO agent_world.codex_worker_readiness
           (worker_id, account_id, authentication, checked_at, authenticated_at, updated_at)
         VALUES ($1, $2, $3, $4::timestamptz,
                 CASE WHEN $3 = 'CHATGPT' THEN $4::timestamptz ELSE NULL END,
                 $4::timestamptz)
         ON CONFLICT (worker_id) DO UPDATE
           SET account_id = EXCLUDED.account_id,
               authentication = EXCLUDED.authentication,
               checked_at = EXCLUDED.checked_at,
               authenticated_at = CASE
                 WHEN EXCLUDED.authentication = 'CHATGPT' THEN EXCLUDED.checked_at
                 ELSE agent_world.codex_worker_readiness.authenticated_at
               END,
               updated_at = EXCLUDED.updated_at`,
        [input.workerId, input.accountId, input.authentication, input.checkedAt],
      );
      if (input.authentication === "CHATGPT") {
        await client.query(
          `UPDATE agent_world.accounts SET health = 'ACTIVE', last_successful_auth_at = $2
            WHERE id = $1`,
          [input.accountId, input.checkedAt],
        );
      } else {
        await client.query(
          `UPDATE agent_world.accounts a
              SET health = CASE
                WHEN readiness.authenticated_at IS NULL THEN 'UNCONFIGURED'
                ELSE 'DEGRADED'
              END
             FROM agent_world.codex_worker_readiness readiness
            WHERE a.id = $1
              AND readiness.worker_id = $2
              AND readiness.account_id = a.id`,
          [input.accountId, input.workerId],
        );
      }
      await client.query("COMMIT");
      return { status: "RECORDED" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
