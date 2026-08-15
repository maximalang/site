import { createHash } from "node:crypto";
import {
  IntegrationIdSchema,
  type IntegrationMutation,
  IntegrationMutationReceiptSchema,
  IntegrationMutationRequestIdSchema,
  IntegrationMutationSchema,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const CommandIdSchema = z.string().trim().min(1).max(512);
const RequestSchema = z.strictObject({
  requestId: IntegrationMutationRequestIdSchema,
  integrationId: IntegrationIdSchema,
  commandId: CommandIdSchema,
  mutation: IntegrationMutationSchema,
  requestedAt: z.iso.datetime({ offset: true }),
});
const DecisionSchema = z.strictObject({
  requestId: IntegrationMutationRequestIdSchema,
  commandId: CommandIdSchema,
  decision: z.enum(["APPROVE", "DENY"]),
  decidedAt: z.iso.datetime({ offset: true }),
});
const CompletionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    requestId: IntegrationMutationRequestIdSchema,
    state: z.literal("SUCCEEDED"),
    completedAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    requestId: IntegrationMutationRequestIdSchema,
    state: z.enum(["FAILED", "OUTCOME_UNKNOWN"]),
    failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    completedAt: z.iso.datetime({ offset: true }),
  }),
]);

type MutationRow = QueryResultRow & {
  id: string;
  integration_id: string;
  mutation_kind: string;
  mutation: unknown;
  request_sha256: string;
  request_command_id: string;
  state: string;
  decision: string | null;
  decision_command_id: string | null;
  decision_sha256: string | null;
  requested_at: Date | string;
  decided_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
};
type TargetRow = QueryResultRow & {
  id: string;
  kind: string;
  transport: string;
  endpoint_url: string | null;
  credential_ref: string | null;
  health: string;
  is_enabled: boolean;
};

const iso = (value: Date | string) =>
  (value instanceof Date ? value : new Date(value)).toISOString();
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

function receipt(row: MutationRow, outcome: "RECORDED" | "REPLAY") {
  return IntegrationMutationReceiptSchema.parse({
    schemaVersion: 1,
    requestId: row.id,
    integrationId: row.integration_id,
    mutation: row.mutation,
    state: row.state,
    outcome,
    requestedAt: iso(row.requested_at),
    ...(row.decided_at === null ? {} : { decidedAt: iso(row.decided_at) }),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
  });
}

const SELECT_MUTATION = `SELECT id, integration_id, mutation_kind, mutation,
       request_sha256, request_command_id, state, decision, decision_command_id,
       decision_sha256, requested_at, decided_at, completed_at, failure_code
  FROM agent_world.integration_mutation_requests WHERE id = $1`;

export class PostgresIntegrationMutationStore {
  constructor(private readonly pool: TransactionPool) {}

  async request(inputValue: z.input<typeof RequestSchema>) {
    const input = RequestSchema.parse(inputValue);
    const requestHash = hash(input);
    const expectedKind = "GITHUB";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.commandId,
      ]);
      const existing = await client.query<MutationRow>(
        `${SELECT_MUTATION} OR request_command_id = $2 FOR UPDATE`,
        [input.requestId, input.commandId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (
          existing.rows.length !== 1 ||
          row.id !== input.requestId ||
          row.request_command_id !== input.commandId ||
          row.request_sha256 !== requestHash
        ) {
          throw new Error("INTEGRATION_MUTATION_CONFLICT");
        }
        await client.query("COMMIT");
        return receipt(row, "REPLAY");
      }
      const target = await client.query<TargetRow>(
        `SELECT id, kind, transport, endpoint_url, credential_ref, health, is_enabled
           FROM agent_world.integration_endpoints WHERE id = $1 FOR SHARE`,
        [input.integrationId],
      );
      const integration = target.rows[0];
      if (
        !integration ||
        integration.kind !== expectedKind ||
        integration.transport !== "HTTPS" ||
        integration.endpoint_url === null ||
        integration.is_enabled !== true ||
        integration.health !== "READY" ||
        integration.credential_ref === null
      ) {
        throw new Error("INTEGRATION_MUTATION_UNAVAILABLE");
      }
      const inserted = await client.query<MutationRow>(
        `INSERT INTO agent_world.integration_mutation_requests
           (id, integration_id, mutation_kind, mutation, request_sha256,
            request_command_id, state, requested_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'PENDING', $7)
         RETURNING *`,
        [
          input.requestId,
          input.integrationId,
          input.mutation.kind,
          JSON.stringify(input.mutation),
          requestHash,
          input.commandId,
          input.requestedAt,
        ],
      );
      if (inserted.rows.length !== 1 || !inserted.rows[0]) throw new Error("PERSISTENCE_FAILED");
      await client.query("COMMIT");
      return receipt(inserted.rows[0], "RECORDED");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async decide(inputValue: z.input<typeof DecisionSchema>) {
    const input = DecisionSchema.parse(inputValue);
    const decisionHash = hash(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.commandId,
      ]);
      const result = await client.query<MutationRow>(`${SELECT_MUTATION} FOR UPDATE`, [
        input.requestId,
      ]);
      const current = result.rows[0];
      if (!current || result.rows.length !== 1) throw new Error("INTEGRATION_MUTATION_NOT_FOUND");
      if (current.decision_command_id !== null) {
        if (
          current.decision_command_id !== input.commandId ||
          current.decision_sha256 !== decisionHash ||
          current.decision !== input.decision
        ) {
          throw new Error("INTEGRATION_MUTATION_CONFLICT");
        }
        await client.query("COMMIT");
        return { receipt: receipt(current, "REPLAY") };
      }
      if (
        current.state !== "PENDING" ||
        Date.parse(input.decidedAt) < Date.parse(iso(current.requested_at))
      ) {
        throw new Error("INTEGRATION_MUTATION_NOT_PENDING");
      }
      const state = input.decision === "APPROVE" ? "EXECUTING" : "DENIED";
      const updated = await client.query<MutationRow>(
        `UPDATE agent_world.integration_mutation_requests
            SET state = $2, decision = $3, decision_command_id = $4,
                decision_sha256 = $5, decided_at = $6::timestamptz,
                completed_at = CASE WHEN $3 = 'DENY' THEN $6::timestamptz ELSE NULL END,
                failure_code = CASE WHEN $3 = 'DENY' THEN 'OWNER_DENIED' ELSE NULL END
          WHERE id = $1 RETURNING *`,
        [input.requestId, state, input.decision, input.commandId, decisionHash, input.decidedAt],
      );
      const row = updated.rows[0];
      if (!row) throw new Error("PERSISTENCE_FAILED");
      if (input.decision === "DENY") {
        await client.query("COMMIT");
        return { receipt: receipt(row, "RECORDED") };
      }
      const target = await client.query<TargetRow>(
        `SELECT id, kind, transport, endpoint_url, credential_ref, health, is_enabled
           FROM agent_world.integration_endpoints WHERE id = $1 FOR SHARE`,
        [row.integration_id],
      );
      const integration = target.rows[0];
      if (
        integration?.transport !== "HTTPS" ||
        integration.endpoint_url === null ||
        integration.credential_ref === null ||
        integration.is_enabled !== true ||
        integration.health !== "READY"
      ) {
        throw new Error("INTEGRATION_MUTATION_UNAVAILABLE");
      }
      await client.query("COMMIT");
      return {
        receipt: receipt(row, "RECORDED"),
        execution: {
          integrationId: IntegrationIdSchema.parse(integration.id),
          endpointUrl: integration.endpoint_url,
          credentialRef: integration.credential_ref,
          mutation: IntegrationMutationSchema.parse(row.mutation) as IntegrationMutation,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(inputValue: z.input<typeof CompletionSchema>) {
    const input = CompletionSchema.parse(inputValue);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<MutationRow>(`${SELECT_MUTATION} FOR UPDATE`, [
        input.requestId,
      ]);
      const current = result.rows[0];
      if (!current || result.rows.length !== 1) throw new Error("INTEGRATION_MUTATION_NOT_FOUND");
      if (["SUCCEEDED", "FAILED", "OUTCOME_UNKNOWN"].includes(current.state)) {
        if (
          current.state !== input.state ||
          current.failure_code !== (input.state === "SUCCEEDED" ? null : input.failureCode)
        ) {
          throw new Error("INTEGRATION_MUTATION_CONFLICT");
        }
        await client.query("COMMIT");
        return receipt(current, "REPLAY");
      }
      if (
        current.state !== "EXECUTING" ||
        current.decided_at === null ||
        Date.parse(input.completedAt) < Date.parse(iso(current.decided_at))
      ) {
        throw new Error("INTEGRATION_MUTATION_NOT_EXECUTING");
      }
      const updated = await client.query<MutationRow>(
        `UPDATE agent_world.integration_mutation_requests
            SET state = $2, completed_at = $3, failure_code = $4
          WHERE id = $1 RETURNING *`,
        [
          input.requestId,
          input.state,
          input.completedAt,
          input.state === "SUCCEEDED" ? null : input.failureCode,
        ],
      );
      if (!updated.rows[0]) throw new Error("PERSISTENCE_FAILED");
      await client.query("COMMIT");
      return receipt(updated.rows[0], "RECORDED");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
