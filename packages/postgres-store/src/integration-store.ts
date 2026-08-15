import { createHash } from "node:crypto";
import {
  type IntegrationAction,
  IntegrationActionResultSchema,
  type IntegrationCreate,
  IntegrationCreateSchema,
  type IntegrationRegistry,
  IntegrationRegistrySchema,
  IntegrationSummarySchema,
  type IntegrationToolAllowlistCreate,
  IntegrationToolAllowlistCreateSchema,
  IntegrationToolAllowlistSummarySchema,
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
type ToolRow = QueryResultRow & {
  id: string;
  integration_id: string;
  label: string;
  tool_name: string;
  fixed_arguments: unknown;
  is_enabled: boolean;
  created_at: Date | string;
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
      const tools = await client.query<ToolRow>(
        `SELECT id, integration_id, label, tool_name, fixed_arguments, is_enabled, created_at
           FROM agent_world.integration_tool_allowlist ORDER BY created_at, id LIMIT 501`,
      );
      if (result.rows.length > 200) throw new Error("Integration registry exceeds bounded limit");
      if (tools.rows.length > 500)
        throw new Error("Integration tool allowlist exceeds bounded limit");
      return IntegrationRegistrySchema.parse({
        schemaVersion: 1,
        generatedAt: this.now().toISOString(),
        integrations: result.rows.map(summary),
        toolAllowlist: tools.rows.map((row) =>
          IntegrationToolAllowlistSummarySchema.parse({
            id: row.id,
            integrationId: row.integration_id,
            label: row.label,
            toolName: row.tool_name,
            fixedArguments: row.fixed_arguments,
            isEnabled: row.is_enabled,
            createdAt: iso(row.created_at),
          }),
        ),
      });
    } finally {
      client.release();
    }
  }

  async createToolAllowlist(inputValue: IntegrationToolAllowlistCreate) {
    const input = IntegrationToolAllowlistCreateSchema.parse(inputValue);
    const requestHash = hash(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.commandId,
      ]);
      const existing = await client.query<{
        request_sha256: string;
        tool_allowlist_id: string;
      }>(
        `SELECT request_sha256, tool_allowlist_id
           FROM agent_world.integration_tool_allowlist_receipts WHERE command_id = $1`,
        [input.commandId],
      );
      if (existing.rows[0]) {
        if (
          existing.rows.length !== 1 ||
          existing.rows[0].request_sha256 !== requestHash ||
          existing.rows[0].tool_allowlist_id !== input.id
        ) {
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        }
        await client.query("COMMIT");
        return { outcome: "REPLAY" as const, toolAllowlistId: input.id };
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO agent_world.integration_tool_allowlist
           (id, integration_id, label, tool_name, fixed_arguments, created_at)
         SELECT $1, endpoint.id, $3, $4, $5::jsonb, $6
           FROM agent_world.integration_endpoints endpoint
          WHERE endpoint.id = $2 AND endpoint.kind = 'MCP'
            AND endpoint.transport = 'HTTPS' AND endpoint.is_enabled = true
            AND endpoint.health = 'READY' AND endpoint.credential_ref IS NOT NULL
         RETURNING id`,
        [
          input.id,
          input.integrationId,
          input.label,
          input.toolName,
          JSON.stringify(input.fixedArguments),
          input.createdAt,
        ],
      );
      if (inserted.rows.length !== 1) throw new Error("INTEGRATION_TOOL_UNAVAILABLE");
      await client.query(
        `INSERT INTO agent_world.integration_tool_allowlist_receipts
           (command_id, request_sha256, tool_allowlist_id, created_at)
         VALUES ($1, $2, $3, $4)`,
        [input.commandId, requestHash, input.id, input.createdAt],
      );
      await client.query("COMMIT");
      return { outcome: "CREATED" as const, toolAllowlistId: input.id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
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

  async prepareAction(input: {
    integrationId: string;
    commandId: string;
    action: IntegrationAction;
  }) {
    const requestHash = hash(input);
    const client = await this.pool.connect();
    try {
      const receipt = await client.query<{
        request_sha256: string;
        action: IntegrationAction;
        status: "SUCCEEDED" | "FAILED";
        result: { status: "SUCCEEDED" | "FAILED"; items: unknown[] };
        executed_at: Date | string;
      }>(
        `SELECT request_sha256, action, status, result, executed_at
           FROM agent_world.integration_action_observations WHERE command_id = $1`,
        [input.commandId],
      );
      if (receipt.rows[0]) {
        const row = receipt.rows[0];
        if (row.request_sha256 !== requestHash || row.action !== input.action)
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        return IntegrationActionResultSchema.parse({
          schemaVersion: 1,
          integrationId: input.integrationId,
          action: input.action,
          outcome: "REPLAY",
          status: row.status,
          items: row.result.items,
          executedAt: iso(row.executed_at),
        });
      }
      const target = await this.loadProbeTarget(input.integrationId);
      if (!target.isEnabled || target.health !== "READY") throw new Error("INTEGRATION_NOT_READY");
      const expectedKind = input.action.split("_", 1)[0];
      if (target.kind !== expectedKind) throw new Error("INTEGRATION_ACTION_KIND_MISMATCH");
      return { outcome: "READY" as const, target };
    } finally {
      client.release();
    }
  }

  async commitAction(
    input: { integrationId: string; commandId: string; action: IntegrationAction },
    result: { status: "SUCCEEDED" | "FAILED"; items: unknown[] },
    executedAt: string,
  ) {
    const parsed = IntegrationActionResultSchema.parse({
      schemaVersion: 1,
      integrationId: input.integrationId,
      action: input.action,
      outcome: "RECORDED",
      ...result,
      executedAt,
    });
    const requestHash = hash(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        input.commandId,
      ]);
      const existing = await client.query<{
        request_sha256: string;
        action: IntegrationAction;
        status: "SUCCEEDED" | "FAILED";
        result: { items: unknown[] };
        executed_at: Date | string;
      }>(
        `SELECT request_sha256, action, status, result, executed_at
           FROM agent_world.integration_action_observations WHERE command_id = $1`,
        [input.commandId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.request_sha256 !== requestHash || row.action !== input.action)
          throw new Error("INTEGRATION_COMMAND_CONFLICT");
        await client.query("COMMIT");
        return IntegrationActionResultSchema.parse({
          ...parsed,
          outcome: "REPLAY",
          status: row.status,
          items: row.result.items,
          executedAt: iso(row.executed_at),
        });
      }
      await client.query(
        `INSERT INTO agent_world.integration_action_observations
           (command_id, request_sha256, integration_id, action, status, result, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          input.commandId,
          requestHash,
          input.integrationId,
          input.action,
          parsed.status,
          JSON.stringify({ status: parsed.status, items: parsed.items }),
          executedAt,
        ],
      );
      await client.query("COMMIT");
      return parsed;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
