import { HUB_READ_LIMITS, type HubReadModel, HubReadModelSchema } from "@agent-world/read-model";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

type Row = QueryResultRow & Record<string, unknown>;

function iso(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function number(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

function optional<Key extends string>(key: Key, value: unknown): Partial<Record<Key, unknown>> {
  return value === null || value === undefined
    ? {}
    : ({ [key]: value } as Partial<Record<Key, unknown>>);
}

function bounded(name: string, rows: Row[], limit: number): Row[] {
  if (rows.length > limit) throw new Error(`${name} collection exceeds the bounded Hub read limit`);
  return rows;
}

function grouped(
  rows: Row[],
  ownerKey: string,
  value: (row: Row) => unknown,
): Map<string, unknown[]> {
  const groups = new Map<string, unknown[]>();
  for (const row of rows) {
    const ownerId = String(row[ownerKey]);
    const values = groups.get(ownerId) ?? [];
    values.push(value(row));
    groups.set(ownerId, values);
  }
  return groups;
}

export class PostgresHubReader {
  constructor(
    private readonly pool: TransactionPool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(): Promise<HubReadModel> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const providers = bounded(
          "Provider",
          (
            await client.query<Row>(
              `SELECT id, slug, display_name, kind, category, base_url, is_enabled
                 FROM agent_world.providers
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.providers + 1],
            )
          ).rows,
          HUB_READ_LIMITS.providers,
        );
        const accounts = bounded(
          "Account",
          (
            await client.query<Row>(
              `SELECT id, provider_id, label, auth_mechanism, subscription, health,
                      last_successful_auth_at, is_enabled, created_at
                 FROM agent_world.accounts
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.accounts + 1],
            )
          ).rows,
          HUB_READ_LIMITS.accounts,
        );
        const accountSurfaces = bounded(
          "Account surface",
          (
            await client.query<Row>(
              `SELECT account_id, surface
                 FROM agent_world.account_surfaces
                ORDER BY account_id, surface
                LIMIT $1`,
              [HUB_READ_LIMITS.executionRoutes + HUB_READ_LIMITS.accounts + 1],
            )
          ).rows,
          HUB_READ_LIMITS.executionRoutes + HUB_READ_LIMITS.accounts,
        );
        const models = bounded(
          "CanonicalModel",
          (
            await client.query<Row>(
              `SELECT id, slug, display_name, family, reasoning, tool_use,
                      context_window_tokens, max_output_tokens, is_enabled
                 FROM agent_world.canonical_models
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.models + 1],
            )
          ).rows,
          HUB_READ_LIMITS.models,
        );
        const modelModalities = bounded(
          "CanonicalModel modality",
          (
            await client.query<Row>(
              `SELECT canonical_model_id, modality
                 FROM agent_world.canonical_model_modalities
                ORDER BY canonical_model_id, modality
                LIMIT $1`,
              [HUB_READ_LIMITS.models * 6 + 1],
            )
          ).rows,
          HUB_READ_LIMITS.models * 6,
        );
        const modelRoutes = bounded(
          "ModelRoute",
          (
            await client.query<Row>(
              `SELECT id, canonical_model_id, provider_id, account_id, surface,
                      remote_model_id, availability, price_currency,
                      input_price_per_million, output_price_per_million,
                      requests_per_minute, tokens_per_minute, latency_p50_ms,
                      quality_score, context_window_tokens, is_enabled
                 FROM agent_world.model_routes
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.modelRoutes + 1],
            )
          ).rows,
          HUB_READ_LIMITS.modelRoutes,
        );
        const routeEfforts = bounded(
          "ModelRoute reasoning effort",
          (
            await client.query<Row>(
              `SELECT model_route_id, effort
                 FROM agent_world.model_route_reasoning_efforts
                ORDER BY model_route_id, effort
                LIMIT $1`,
              [HUB_READ_LIMITS.modelRoutes * 5 + 1],
            )
          ).rows,
          HUB_READ_LIMITS.modelRoutes * 5,
        );
        const routeModalities = bounded(
          "ModelRoute modality",
          (
            await client.query<Row>(
              `SELECT model_route_id, modality
                 FROM agent_world.model_route_modalities
                ORDER BY model_route_id, modality
                LIMIT $1`,
              [HUB_READ_LIMITS.modelRoutes * 6 + 1],
            )
          ).rows,
          HUB_READ_LIMITS.modelRoutes * 6,
        );
        const routeTools = bounded(
          "ModelRoute Tool",
          (
            await client.query<Row>(
              `SELECT model_route_id, tool_id
                 FROM agent_world.model_route_tools
                ORDER BY model_route_id, tool_id
                LIMIT $1`,
              [HUB_READ_LIMITS.assignments + 1],
            )
          ).rows,
          HUB_READ_LIMITS.assignments,
        );
        const executionRoutes = bounded(
          "ExecutionRoute",
          (
            await client.query<Row>(
              `SELECT id, label, mode, adapter_kind, account_id, model_route_id, is_enabled
                 FROM agent_world.execution_routes
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.executionRoutes + 1],
            )
          ).rows,
          HUB_READ_LIMITS.executionRoutes,
        );
        const agents = bounded(
          "Agent",
          (
            await client.query<Row>(
              `SELECT id, slug, display_name, role, preferred_route_id, is_enabled
                 FROM agent_world.agents
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.agents + 1],
            )
          ).rows,
          HUB_READ_LIMITS.agents,
        );
        const agentSkills = bounded(
          "Agent Skill assignment",
          (
            await client.query<Row>(
              `SELECT agent_id, skill_id, priority, is_enabled
                 FROM agent_world.agent_skills
                ORDER BY agent_id, skill_id
                LIMIT $1`,
              [HUB_READ_LIMITS.assignments + 1],
            )
          ).rows,
          HUB_READ_LIMITS.assignments,
        );
        const agentTools = bounded(
          "Agent Tool assignment",
          (
            await client.query<Row>(
              `SELECT agent_id, tool_id, is_enabled
                 FROM agent_world.agent_tools
                ORDER BY agent_id, tool_id
                LIMIT $1`,
              [HUB_READ_LIMITS.assignments + 1],
            )
          ).rows,
          HUB_READ_LIMITS.assignments,
        );
        const skills = bounded(
          "Skill",
          (
            await client.query<Row>(
              `SELECT id, slug, display_name, version, description, source_kind,
                      integrity_sha256, is_enabled
                 FROM agent_world.skills
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.skills + 1],
            )
          ).rows,
          HUB_READ_LIMITS.skills,
        );
        const tools = bounded(
          "Tool",
          (
            await client.query<Row>(
              `SELECT id, slug, display_name, kind, description, is_enabled
                 FROM agent_world.tools
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.tools + 1],
            )
          ).rows,
          HUB_READ_LIMITS.tools,
        );
        const projects = bounded(
          "Project",
          (
            await client.query<Row>(
              `SELECT id, slug, name, description, is_archived, created_at
                 FROM agent_world.projects
                ORDER BY id
                LIMIT $1`,
              [HUB_READ_LIMITS.projects + 1],
            )
          ).rows,
          HUB_READ_LIMITS.projects,
        );
        const projectAgents = bounded(
          "Project Agent membership",
          (
            await client.query<Row>(
              `SELECT project_id, agent_id
                 FROM agent_world.project_agents
                ORDER BY project_id, agent_id
                LIMIT $1`,
              [HUB_READ_LIMITS.memberships + 1],
            )
          ).rows,
          HUB_READ_LIMITS.memberships,
        );

        const surfacesByAccount = grouped(accountSurfaces, "account_id", (row) => row.surface);
        const modalitiesByModel = grouped(
          modelModalities,
          "canonical_model_id",
          (row) => row.modality,
        );
        const effortsByRoute = grouped(routeEfforts, "model_route_id", (row) => row.effort);
        const modalitiesByRoute = grouped(routeModalities, "model_route_id", (row) => row.modality);
        const toolsByRoute = grouped(routeTools, "model_route_id", (row) => row.tool_id);
        const skillsByAgent = grouped(agentSkills, "agent_id", (row) => ({
          skillId: row.skill_id,
          priority: row.priority,
          isEnabled: row.is_enabled,
        }));
        const toolsByAgent = grouped(agentTools, "agent_id", (row) => ({
          toolId: row.tool_id,
          isEnabled: row.is_enabled,
        }));
        const agentsByProject = grouped(projectAgents, "project_id", (row) => row.agent_id);
        const routesByModel = grouped(modelRoutes, "canonical_model_id", (row) => ({
          modelRouteId: row.id,
          providerId: row.provider_id,
          ...optional("accountId", row.account_id),
          surface: row.surface,
          remoteModelId: row.remote_model_id,
          availability: row.availability,
          ...(row.price_currency === null
            ? {}
            : {
                pricing: {
                  currency: row.price_currency,
                  inputPerMillion: number(row.input_price_per_million),
                  outputPerMillion: number(row.output_price_per_million),
                },
              }),
          ...(row.requests_per_minute === null && row.tokens_per_minute === null
            ? {}
            : {
                limits: {
                  ...optional("requestsPerMinute", number(row.requests_per_minute)),
                  ...optional("tokensPerMinute", number(row.tokens_per_minute)),
                },
              }),
          ...optional("latencyP50Ms", number(row.latency_p50_ms)),
          ...optional("qualityScore", number(row.quality_score)),
          contextWindowTokens: number(row.context_window_tokens),
          reasoningEfforts: effortsByRoute.get(String(row.id)) ?? [],
          supportedModalities: modalitiesByRoute.get(String(row.id)) ?? [],
          supportedToolIds: toolsByRoute.get(String(row.id)) ?? [],
          isEnabled: row.is_enabled,
        }));

        const model = HubReadModelSchema.parse({
          schemaVersion: 1,
          generatedAt: this.now().toISOString(),
          providers: providers.map((row) => ({
            providerId: row.id,
            slug: row.slug,
            displayName: row.display_name,
            kind: row.kind,
            category: row.category,
            ...optional("baseUrl", row.base_url),
            isEnabled: row.is_enabled,
          })),
          accounts: accounts.map((row) => ({
            accountId: row.id,
            providerId: row.provider_id,
            label: row.label,
            authMechanism: row.auth_mechanism,
            ...optional("subscription", row.subscription),
            availableSurfaces: surfacesByAccount.get(String(row.id)) ?? [],
            health: row.health,
            ...optional("lastSuccessfulAuthAt", iso(row.last_successful_auth_at)),
            isEnabled: row.is_enabled,
            createdAt: iso(row.created_at),
          })),
          models: models.map((row) => ({
            modelId: row.id,
            slug: row.slug,
            displayName: row.display_name,
            family: row.family,
            capabilities: {
              reasoning: row.reasoning,
              toolUse: row.tool_use,
              modalities: modalitiesByModel.get(String(row.id)) ?? [],
              contextWindowTokens: number(row.context_window_tokens),
              ...optional("maxOutputTokens", number(row.max_output_tokens)),
            },
            isEnabled: row.is_enabled,
            routes: routesByModel.get(String(row.id)) ?? [],
          })),
          executionRoutes: executionRoutes.map((row) => ({
            routeId: row.id,
            label: row.label,
            mode: row.mode,
            adapterKind: row.adapter_kind,
            ...optional("accountId", row.account_id),
            ...optional("modelRouteId", row.model_route_id),
            isEnabled: row.is_enabled,
          })),
          agents: agents.map((row) => ({
            agentId: row.id,
            slug: row.slug,
            displayName: row.display_name,
            role: row.role,
            ...optional("preferredRouteId", row.preferred_route_id),
            isEnabled: row.is_enabled,
            skillAssignments: skillsByAgent.get(String(row.id)) ?? [],
            toolAssignments: toolsByAgent.get(String(row.id)) ?? [],
          })),
          skills: skills.map((row) => ({
            skillId: row.id,
            slug: row.slug,
            displayName: row.display_name,
            version: row.version,
            description: row.description,
            sourceKind: row.source_kind,
            integritySha256: row.integrity_sha256,
            isEnabled: row.is_enabled,
          })),
          tools: tools.map((row) => ({
            toolId: row.id,
            slug: row.slug,
            displayName: row.display_name,
            kind: row.kind,
            description: row.description,
            isEnabled: row.is_enabled,
          })),
          projects: projects.map((row) => ({
            projectId: row.id,
            slug: row.slug,
            name: row.name,
            ...optional("description", row.description),
            isArchived: row.is_archived,
            createdAt: iso(row.created_at),
            agentIds: agentsByProject.get(String(row.id)) ?? [],
          })),
        });
        await client.query("COMMIT");
        return model;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  }
}
