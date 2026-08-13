import { ModelRouteIdSchema, type ProviderKind } from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

export const ROUTE_RESOLUTION_ERROR_CODES = [
  "NOT_FOUND",
  "INELIGIBLE_ROUTE",
  "LOCAL_ENDPOINT_DENIED",
] as const;
export type RouteResolutionErrorCode = (typeof ROUTE_RESOLUTION_ERROR_CODES)[number];

export class RouteResolutionError extends Error {
  override readonly name = "RouteResolutionError";

  constructor(readonly code: RouteResolutionErrorCode) {
    super(code);
  }
}

export type ResolvedModelRoute = {
  schemaVersion: 1;
  modelRouteId: ReturnType<typeof ModelRouteIdSchema.parse>;
  modelAlias: string;
  providerKind: ProviderKind;
  providerModel: string;
  apiBase?: string;
  credentialRef?: string;
};

type RouteRow = QueryResultRow & {
  model_route_id: string;
  remote_model_id: string;
  surface: string;
  availability: string;
  route_enabled: boolean;
  provider_id: string;
  provider_kind: ProviderKind;
  provider_category: string;
  provider_base_url: string | null;
  provider_enabled: boolean;
  account_id: string | null;
  account_health: string | null;
  account_enabled: boolean | null;
  credential_ref: string | null;
  secret_purpose: string | null;
};

const PROVIDER_PREFIX: Partial<Record<ProviderKind, string>> = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "gemini",
  OPENROUTER: "openrouter",
  XAI: "xai",
  DEEPSEEK: "deepseek",
  MISTRAL: "mistral",
  GROQ: "groq",
  AZURE_OPENAI: "azure",
  AWS_BEDROCK: "bedrock",
  OLLAMA: "ollama",
  LM_STUDIO: "openai",
  CUSTOM_OPENAI_COMPATIBLE: "openai",
};

function exactOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Allowed local model endpoint must be an absolute HTTP(S) origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new TypeError("Allowed local model endpoint must be an HTTP(S) origin");
  }
  return url.origin;
}

function endpointOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RouteResolutionError("LOCAL_ENDPOINT_DENIED");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new RouteResolutionError("LOCAL_ENDPOINT_DENIED");
  }
  return url.origin;
}

export class PostgresModelRouteResolver {
  private readonly allowedLocalOrigins: ReadonlySet<string>;

  constructor(
    private readonly pool: TransactionPool,
    options: { allowedLocalOrigins?: readonly string[] } = {},
  ) {
    this.allowedLocalOrigins = new Set((options.allowedLocalOrigins ?? []).map(exactOrigin));
  }

  async resolve(modelRouteIdInput: string): Promise<ResolvedModelRoute> {
    const modelRouteId = ModelRouteIdSchema.parse(modelRouteIdInput);
    const client = await this.pool.connect();
    let row: RouteRow | undefined;
    try {
      row = (
        await client.query<RouteRow>(
          `SELECT mr.id AS model_route_id, mr.remote_model_id, mr.surface,
                  mr.availability, mr.is_enabled AS route_enabled,
                  p.id AS provider_id, p.kind AS provider_kind,
                  p.category AS provider_category, p.base_url AS provider_base_url,
                  p.is_enabled AS provider_enabled,
                  a.id AS account_id, a.health AS account_health,
                  a.is_enabled AS account_enabled, a.credential_ref,
                  s.purpose AS secret_purpose
             FROM agent_world.model_routes mr
             JOIN agent_world.providers p ON p.id = mr.provider_id
             LEFT JOIN agent_world.accounts a ON a.id = mr.account_id
             LEFT JOIN agent_world.encrypted_secrets s ON s.secret_ref = a.credential_ref
            WHERE mr.id = $1`,
          [modelRouteId],
        )
      ).rows[0];
    } finally {
      client.release();
    }
    if (!row) throw new RouteResolutionError("NOT_FOUND");
    const prefix = PROVIDER_PREFIX[row.provider_kind];
    if (
      row.model_route_id !== modelRouteId ||
      row.availability !== "AVAILABLE" ||
      !row.route_enabled ||
      !row.provider_enabled ||
      prefix === undefined
    ) {
      throw new RouteResolutionError("INELIGIBLE_ROUTE");
    }

    const common = {
      schemaVersion: 1 as const,
      modelRouteId,
      modelAlias: `route-${modelRouteId}`,
      providerKind: row.provider_kind,
      providerModel: `${prefix}/${row.remote_model_id}`,
    };
    if (row.surface === "API" && row.provider_category === "LLM_API") {
      if (
        row.account_id === null ||
        row.account_health !== "ACTIVE" ||
        row.account_enabled !== true ||
        row.credential_ref === null ||
        !row.credential_ref.startsWith("secret-store:") ||
        row.secret_purpose !== "PROVIDER_API_KEY"
      ) {
        throw new RouteResolutionError("INELIGIBLE_ROUTE");
      }
      return {
        ...common,
        ...(row.provider_base_url === null ? {} : { apiBase: row.provider_base_url }),
        credentialRef: row.credential_ref,
      };
    }
    if (row.surface === "LOCAL" && row.provider_category === "LOCAL_MODEL") {
      if (
        row.account_id !== null ||
        row.provider_base_url === null ||
        !this.allowedLocalOrigins.has(endpointOrigin(row.provider_base_url))
      ) {
        throw new RouteResolutionError("LOCAL_ENDPOINT_DENIED");
      }
      return { ...common, apiBase: row.provider_base_url };
    }
    throw new RouteResolutionError("INELIGIBLE_ROUTE");
  }

  async listCandidateRouteIds(): Promise<ResolvedModelRoute["modelRouteId"][]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ id: string }>(
        `SELECT id
           FROM agent_world.model_routes
          WHERE is_enabled = true AND availability = 'AVAILABLE'
          ORDER BY id
          LIMIT 5000`,
      );
      return result.rows.map(({ id }) => ModelRouteIdSchema.parse(id));
    } finally {
      client.release();
    }
  }
}
