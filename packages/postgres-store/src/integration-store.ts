import { createHash } from "node:crypto";
import {
  type IntegrationCreate,
  IntegrationCreateSchema,
  type IntegrationRegistry,
  IntegrationRegistrySchema,
  IntegrationSummarySchema,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type Row = QueryResultRow & {
  id: string;
  kind: string;
  label: string;
  transport: string;
  endpoint_url: string | null;
  ssh_host: string | null;
  ssh_port: number | null;
  ssh_username: string | null;
  credential_ref: string | null;
  health: string;
  is_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

function iso(value: Date | string) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
function summary(row: Row) {
  return IntegrationSummarySchema.parse({
    id: row.id,
    kind: row.kind,
    label: row.label,
    endpoint:
      row.transport === "HTTPS"
        ? { transport: "HTTPS", url: row.endpoint_url }
        : { transport: "SSH", host: row.ssh_host, port: row.ssh_port, username: row.ssh_username },
    health: row.health,
    isEnabled: row.is_enabled,
    hasCredential: row.credential_ref !== null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export class PostgresIntegrationStore {
  constructor(
    private readonly pool: TransactionPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<IntegrationRegistry> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<Row>(
        `SELECT id, kind, label, transport, endpoint_url, ssh_host, ssh_port,
                ssh_username, credential_ref, health, is_enabled, created_at, updated_at
           FROM agent_world.integration_endpoints ORDER BY id LIMIT 201`,
      );
      if (result.rows.length > 200) throw new Error("Integration registry exceeds bounded limit");
      return IntegrationRegistrySchema.parse({
        schemaVersion: 1,
        generatedAt: this.now().toISOString(),
        integrations: result.rows.map(summary),
      });
    } finally {
      client.release();
    }
  }

  async create(input: IntegrationCreate) {
    const value = IntegrationCreateSchema.parse(input);
    const requestHash = hash(value);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        value.commandId,
      ]);
      const receipt = await client.query<{ request_sha256: string; integration_id: string }>(
        "SELECT request_sha256, integration_id FROM agent_world.integration_command_receipts WHERE command_id = $1",
        [value.commandId],
      );
      if (receipt.rows[0]) {
        if (
          receipt.rows[0].request_sha256 !== requestHash ||
          receipt.rows[0].integration_id !== value.id
        )
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, integrationId: value.id };
      }
      await client.query(
        `INSERT INTO agent_world.integration_endpoints
           (id, kind, label, transport, endpoint_url, ssh_host, ssh_port,
            ssh_username, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          value.id,
          value.kind,
          value.label,
          value.endpoint.transport,
          value.endpoint.transport === "HTTPS" ? value.endpoint.url : null,
          value.endpoint.transport === "SSH" ? value.endpoint.host : null,
          value.endpoint.transport === "SSH" ? value.endpoint.port : null,
          value.endpoint.transport === "SSH" ? value.endpoint.username : null,
          value.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO agent_world.integration_command_receipts
           (command_id, request_sha256, integration_id, created_at) VALUES ($1, $2, $3, $4)`,
        [value.commandId, requestHash, value.id, value.createdAt],
      );
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, integrationId: value.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async bindCredential(integrationId: string, secretRef: string, updatedAt: string): Promise<void> {
    if (secretRef !== `secret-store:integrations/${integrationId}/credential`) {
      throw new Error("INTEGRATION_CREDENTIAL_REFERENCE_INVALID");
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ id: string }>(
        `UPDATE agent_world.integration_endpoints
            SET credential_ref = $2, health = 'UNCONFIGURED', updated_at = $3
          WHERE id = $1 AND updated_at <= $3
        RETURNING id`,
        [integrationId, secretRef, updatedAt],
      );
      if (result.rows.length !== 1) throw new Error("INTEGRATION_NOT_FOUND");
    } finally {
      client.release();
    }
  }

  async setEnabled(input: {
    operation: "ENABLE" | "DISABLE";
    integrationId: string;
    commandId: string;
    updatedAt: string;
  }) {
    const requestHash = hash(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.commandId,
      ]);
      const receipt = await client.query<{ request_sha256: string; integration_id: string }>(
        "SELECT request_sha256, integration_id FROM agent_world.integration_command_receipts WHERE command_id = $1",
        [input.commandId],
      );
      if (receipt.rows[0]) {
        if (
          receipt.rows[0].request_sha256 !== requestHash ||
          receipt.rows[0].integration_id !== input.integrationId
        )
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, integrationId: input.integrationId };
      }
      const updated = await client.query<{ id: string }>(
        `UPDATE agent_world.integration_endpoints
            SET is_enabled = $2, health = 'UNCONFIGURED', updated_at = $3
          WHERE id = $1 AND updated_at <= $3
        RETURNING id`,
        [input.integrationId, input.operation === "ENABLE", input.updatedAt],
      );
      if (updated.rows.length !== 1) throw new Error("INTEGRATION_NOT_FOUND");
      await client.query(
        `INSERT INTO agent_world.integration_command_receipts
           (command_id, request_sha256, integration_id, created_at) VALUES ($1, $2, $3, $4)`,
        [input.commandId, requestHash, input.integrationId, input.updatedAt],
      );
      await client.query("COMMIT");
      return { outcome: "UPDATED" as const, integrationId: input.integrationId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async loadProbeTarget(integrationId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<Row>(
        `SELECT id, kind, label, transport, endpoint_url, ssh_host, ssh_port,
                ssh_username, credential_ref, health, is_enabled, created_at, updated_at
           FROM agent_world.integration_endpoints WHERE id = $1`,
        [integrationId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("INTEGRATION_NOT_FOUND");
      return {
        ...summary(row),
        credentialRef: row.credential_ref,
      };
    } finally {
      client.release();
    }
  }

  async prepareProbe(input: { integrationId: string; commandId: string }) {
    const client = await this.pool.connect();
    try {
      const requestHash = hash(input);
      const receipt = await client.query<{
        request_sha256: string;
        health: "READY" | "ERROR";
        code: string;
        checked_at: Date | string;
      }>(
        `SELECT request_sha256, health, code, checked_at
           FROM agent_world.integration_probe_observations WHERE command_id = $1`,
        [input.commandId],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_sha256 !== requestHash)
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        return {
          outcome: "REPLAY" as const,
          result: {
            health: receipt.rows[0].health,
            code: receipt.rows[0].code,
            checkedAt: iso(receipt.rows[0].checked_at),
          },
        };
      }
      const target = await client.query<Row>(
        `SELECT id, kind, label, transport, endpoint_url, ssh_host, ssh_port,
                ssh_username, credential_ref, health, is_enabled, created_at, updated_at
           FROM agent_world.integration_endpoints WHERE id = $1`,
        [input.integrationId],
      );
      const row = target.rows[0];
      if (!row) throw new Error("INTEGRATION_NOT_FOUND");
      return {
        outcome: "READY" as const,
        target: { ...summary(row), credentialRef: row.credential_ref },
      };
    } finally {
      client.release();
    }
  }

  async commitProbe(
    input: { integrationId: string; commandId: string },
    result: { health: "READY" | "ERROR"; code: string },
    checkedAt: string,
  ) {
    const requestHash = hash(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.commandId,
      ]);
      const receipt = await client.query<{
        request_sha256: string;
        health: "READY" | "ERROR";
        code: string;
        checked_at: Date | string;
      }>(
        `SELECT request_sha256, health, code, checked_at FROM agent_world.integration_probe_observations WHERE command_id = $1`,
        [input.commandId],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].request_sha256 !== requestHash)
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        await client.query("COMMIT");
        return {
          outcome: "REPLAY" as const,
          health: receipt.rows[0].health,
          code: receipt.rows[0].code,
          checkedAt: iso(receipt.rows[0].checked_at),
        };
      }
      const updated = await client.query<{ id: string }>(
        `UPDATE agent_world.integration_endpoints SET health = $2, updated_at = $3
          WHERE id = $1 AND is_enabled = true AND updated_at <= $3 RETURNING id`,
        [input.integrationId, result.health, checkedAt],
      );
      if (updated.rows.length !== 1) throw new Error("INTEGRATION_NOT_PROBEABLE");
      await client.query(
        `INSERT INTO agent_world.integration_probe_observations
           (command_id, request_sha256, integration_id, health, code, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.commandId, requestHash, input.integrationId, result.health, result.code, checkedAt],
      );
      await client.query("COMMIT");
      return { outcome: "RECORDED" as const, ...result, checkedAt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
