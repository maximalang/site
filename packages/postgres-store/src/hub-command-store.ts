import { createHash } from "node:crypto";
import {
  type HubCommandRequest,
  type HubCommandResponse,
  HubCommandResponseSchema,
} from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionClient, TransactionPool } from "./conversation-store.js";

export const HUB_COMMAND_STORE_ERROR_CODES = [
  "IDEMPOTENCY_CONFLICT",
  "RESOURCE_CONFLICT",
  "INVALID_REFERENCE",
] as const;
export type HubCommandStoreErrorCode = (typeof HUB_COMMAND_STORE_ERROR_CODES)[number];

export class HubCommandStoreError extends Error {
  override readonly name = "HubCommandStoreError";

  constructor(readonly code: HubCommandStoreErrorCode) {
    super(code);
  }
}

export function isHubCommandStoreError(error: unknown): error is HubCommandStoreError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "HubCommandStoreError" &&
    "code" in error &&
    HUB_COMMAND_STORE_ERROR_CODES.includes(error.code as HubCommandStoreErrorCode)
  );
}

type ReceiptRow = QueryResultRow & {
  request_sha256: string;
  response: unknown;
};

function requestHash(command: HubCommandRequest): string {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof HubCommandStoreError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
  if (code === "23505") return new HubCommandStoreError("RESOURCE_CONFLICT");
  if (code === "23503" || code === "23514") {
    return new HubCommandStoreError("INVALID_REFERENCE");
  }
  return error;
}

function created(
  commandId: HubCommandRequest["commandId"],
  resource: HubCommandResponse["resource"],
): HubCommandResponse {
  return HubCommandResponseSchema.parse({
    schemaVersion: 1,
    outcome: "CREATED",
    commandId,
    resource,
  });
}

export class PostgresHubCommandStore {
  constructor(
    private readonly pool: TransactionPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(command: HubCommandRequest): Promise<HubCommandResponse> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          command.commandId,
        ]);
        const hash = requestHash(command);
        const receipt = (
          await client.query<ReceiptRow>(
            `SELECT request_sha256, response
               FROM agent_world.hub_command_receipts
              WHERE id = $1
              FOR UPDATE`,
            [command.commandId],
          )
        ).rows[0];
        if (receipt) {
          if (receipt.request_sha256 !== hash) {
            throw new HubCommandStoreError("IDEMPOTENCY_CONFLICT");
          }
          const stored = HubCommandResponseSchema.parse(receipt.response);
          const replay = HubCommandResponseSchema.parse({ ...stored, outcome: "REPLAY" });
          await client.query("COMMIT");
          return replay;
        }

        const response = await this.createResource(client, command);
        await client.query(
          `INSERT INTO agent_world.hub_command_receipts
             (id, kind, request_sha256, response, created_at)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            command.commandId,
            command.kind,
            hash,
            JSON.stringify(response),
            this.now().toISOString(),
          ],
        );
        await client.query("COMMIT");
        return response;
      } catch (error) {
        await client.query("ROLLBACK");
        throw mapDatabaseError(error);
      }
    } finally {
      client.release();
    }
  }

  private async createResource(
    client: TransactionClient,
    command: HubCommandRequest,
  ): Promise<HubCommandResponse> {
    switch (command.kind) {
      case "PROVIDER_CREATE":
        await client.query(
          `INSERT INTO agent_world.providers
             (id, slug, display_name, kind, category, base_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            command.providerId,
            command.slug,
            command.displayName,
            command.providerKind,
            command.category,
            command.baseUrl ?? null,
          ],
        );
        return created(command.commandId, { kind: "PROVIDER", id: command.providerId });
      case "ACCOUNT_CREATE":
        await client.query(
          `INSERT INTO agent_world.accounts
             (id, label, provider_id, auth_mechanism, subscription, health)
           VALUES ($1, $2, $3, $4, $5, 'UNCONFIGURED')`,
          [
            command.accountId,
            command.label,
            command.providerId,
            command.authMechanism,
            command.subscription ?? null,
          ],
        );
        await client.query(
          `INSERT INTO agent_world.account_surfaces (account_id, surface)
           SELECT $1, unnest($2::text[])`,
          [command.accountId, command.availableSurfaces],
        );
        return created(command.commandId, { kind: "ACCOUNT", id: command.accountId });
      case "CANONICAL_MODEL_CREATE":
        await client.query(
          `INSERT INTO agent_world.canonical_models
             (id, slug, display_name, family, reasoning, tool_use,
              context_window_tokens, max_output_tokens)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            command.modelId,
            command.slug,
            command.displayName,
            command.family,
            command.capabilities.reasoning,
            command.capabilities.toolUse,
            command.capabilities.contextWindowTokens,
            command.capabilities.maxOutputTokens ?? null,
          ],
        );
        await client.query(
          `INSERT INTO agent_world.canonical_model_modalities
             (canonical_model_id, modality)
           SELECT $1, unnest($2::text[])`,
          [command.modelId, command.capabilities.modalities],
        );
        return created(command.commandId, { kind: "CANONICAL_MODEL", id: command.modelId });
      case "MODEL_ROUTE_CREATE":
        await client.query(
          `INSERT INTO agent_world.model_routes
             (id, canonical_model_id, provider_id, account_id, surface,
              remote_model_id, availability, price_currency,
              input_price_per_million, output_price_per_million,
              requests_per_minute, tokens_per_minute, latency_p50_ms,
              quality_score, context_window_tokens)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            command.modelRouteId,
            command.canonicalModelId,
            command.providerId,
            command.accountId ?? null,
            command.surface,
            command.remoteModelId,
            command.availability,
            command.pricing?.currency ?? null,
            command.pricing?.inputPerMillion ?? null,
            command.pricing?.outputPerMillion ?? null,
            command.limits?.requestsPerMinute ?? null,
            command.limits?.tokensPerMinute ?? null,
            command.latencyP50Ms ?? null,
            command.qualityScore ?? null,
            command.contextWindowTokens,
          ],
        );
        if (command.reasoningEfforts.length > 0) {
          await client.query(
            `INSERT INTO agent_world.model_route_reasoning_efforts (model_route_id, effort)
             SELECT $1, unnest($2::text[])`,
            [command.modelRouteId, command.reasoningEfforts],
          );
        }
        await client.query(
          `INSERT INTO agent_world.model_route_modalities (model_route_id, modality)
           SELECT $1, unnest($2::text[])`,
          [command.modelRouteId, command.supportedModalities],
        );
        if (command.supportedToolIds.length > 0) {
          await client.query(
            `INSERT INTO agent_world.model_route_tools (model_route_id, tool_id)
             SELECT $1, unnest($2::text[])`,
            [command.modelRouteId, command.supportedToolIds],
          );
        }
        return created(command.commandId, { kind: "MODEL_ROUTE", id: command.modelRouteId });
      case "CODEX_ROUTE_CREATE": {
        const inserted = await client.query<{ id: string; remote_model_id: string }>(
          `INSERT INTO agent_world.execution_routes
             (id, label, mode, adapter_kind, account_id, model_route_id)
           SELECT $1, $2, 'CODEX', 'CODEX', a.id, mr.id
             FROM agent_world.accounts a
             JOIN agent_world.account_surfaces surface
               ON surface.account_id = a.id AND surface.surface = 'CODEX'
             JOIN agent_world.model_routes mr
               ON mr.id = $4
              AND mr.account_id = a.id
              AND mr.surface = 'CODEX'
              AND mr.is_enabled = true
            WHERE a.id = $3
              AND a.auth_mechanism = 'CHATGPT_INTERACTIVE'
              AND a.is_enabled = true
          RETURNING id,
                    (SELECT remote_model_id FROM agent_world.model_routes WHERE id = $4)
                      AS remote_model_id`,
          [command.routeId, command.label, command.accountId, command.modelRouteId],
        );
        if (inserted.rows.length !== 1 || !inserted.rows[0]) {
          throw new HubCommandStoreError("INVALID_REFERENCE");
        }
        await client.query(
          `INSERT INTO agent_world.codex_execution_policies
             (route_id, account_id, working_directory, sandbox, approval_policy,
              network_access, timeout_ms, model, reasoning_effort)
           VALUES ($1, $2, '/workspaces/project', 'WORKSPACE_WRITE', 'ON_REQUEST',
                   false, 600000, $3, $4)`,
          [
            command.routeId,
            command.accountId,
            inserted.rows[0].remote_model_id,
            command.reasoningEffort ?? null,
          ],
        );
        return created(command.commandId, { kind: "EXECUTION_ROUTE", id: command.routeId });
      }
      case "AGENT_CREATE":
        await client.query(
          `INSERT INTO agent_world.agents
             (id, slug, display_name, role, instructions, preferred_route_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            command.agentId,
            command.slug,
            command.displayName,
            command.role,
            command.instructions,
            command.preferredRouteId ?? null,
          ],
        );
        return created(command.commandId, { kind: "AGENT", id: command.agentId });
      case "SKILL_CREATE":
        await client.query(
          `INSERT INTO agent_world.skills
             (id, slug, display_name, version, description, source_kind,
              source_ref, integrity_sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            command.skillId,
            command.slug,
            command.displayName,
            command.version,
            command.description,
            command.sourceKind,
            command.sourceRef,
            command.integritySha256,
          ],
        );
        return created(command.commandId, { kind: "SKILL", id: command.skillId });
      case "TOOL_CREATE":
        await client.query(
          `INSERT INTO agent_world.tools (id, slug, display_name, kind, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            command.toolId,
            command.slug,
            command.displayName,
            command.toolKind,
            command.description,
          ],
        );
        return created(command.commandId, { kind: "TOOL", id: command.toolId });
      case "PROJECT_CREATE":
        await client.query(
          `INSERT INTO agent_world.projects (id, slug, name, description)
           VALUES ($1, $2, $3, $4)`,
          [command.projectId, command.slug, command.name, command.description ?? null],
        );
        return created(command.commandId, { kind: "PROJECT", id: command.projectId });
      default:
        command satisfies never;
        throw new Error("Unsupported Hub command kind");
    }
  }
}
