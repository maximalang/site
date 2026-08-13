import {
  type Agent,
  AgentSchema,
  BindingIdSchema,
  ConversationIdSchema,
  OpaqueExternalIdSchema,
  SessionIdSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool } from "./conversation-store.js";

const MAX_AGENTS = 500;
const MAX_BINDINGS = 1_000;
const MAX_MESSAGE_SESSIONS = 100;
const EXTERNAL_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type AgentRow = QueryResultRow & {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  instructions: string;
  is_enabled: boolean;
};

type BindingRow = QueryResultRow & {
  id: string;
  agent_id: string;
  external_agent_id: string;
  display_name: string;
};

type MessageSessionRow = QueryResultRow & {
  id: string;
  conversation_id: string;
  agent_id: string;
  binding_id: string;
  external_agent_id: string;
  external_session_ref: string;
};

export type OpenClawCanonicalBinding = {
  agentId: Agent["id"];
  bindingId: ReturnType<typeof BindingIdSchema.parse>;
  externalAgentId: string;
  displayName: string;
};

export type OpenClawRuntimeConfiguration = {
  agents: Agent[];
  bindings: OpenClawCanonicalBinding[];
  messageSessions: OpenClawMessageSession[];
};

export type OpenClawMessageSession = {
  conversationId: ReturnType<typeof ConversationIdSchema.parse>;
  sessionId: ReturnType<typeof SessionIdSchema.parse>;
  agentId: Agent["id"];
  bindingId: ReturnType<typeof BindingIdSchema.parse>;
  externalAgentId: string;
  externalSessionKey: string;
};

function parseExternalAgentId(input: unknown): string {
  const value = OpaqueExternalIdSchema.max(128).parse(input);
  if (!EXTERNAL_AGENT_ID.test(value)) {
    throw new Error("OpenClaw external Agent ID is not a safe routing identifier");
  }
  return value;
}

function assertUniqueBindings(bindings: OpenClawCanonicalBinding[]): void {
  const agents = new Set<string>();
  const externalIds = new Set<string>();
  for (const binding of bindings) {
    if (agents.has(binding.agentId)) {
      throw new Error(`Canonical Agent has multiple enabled OpenClaw bindings: ${binding.agentId}`);
    }
    if (externalIds.has(binding.externalAgentId)) {
      throw new Error(
        `OpenClaw external Agent ID is bound more than once: ${binding.externalAgentId}`,
      );
    }
    agents.add(binding.agentId);
    externalIds.add(binding.externalAgentId);
  }
}

export class PostgresOpenClawConfigurationReader {
  constructor(private readonly pool: TransactionPool) {}

  async read(): Promise<OpenClawRuntimeConfiguration> {
    const client = await this.pool.connect();
    try {
      const [agentsResult, bindingsResult, messageSessionsResult] = await Promise.all([
        client.query<AgentRow>(
          `SELECT id, slug, display_name, role, instructions, is_enabled
             FROM agent_world.agents
            ORDER BY id
            LIMIT $1`,
          [MAX_AGENTS + 1],
        ),
        client.query<BindingRow>(
          `SELECT b.id, b.agent_id, b.external_agent_id, a.display_name
             FROM agent_world.runtime_bindings b
             JOIN agent_world.agents a ON a.id = b.agent_id
             JOIN agent_world.execution_routes r ON r.id = b.route_id
            WHERE b.adapter_kind = 'OPENCLAW'
              AND r.adapter_kind = 'OPENCLAW'
              AND b.is_enabled = true
              AND r.is_enabled = true
              AND a.is_enabled = true
            ORDER BY b.id
            LIMIT $1`,
          [MAX_BINDINGS + 1],
        ),
        client.query<MessageSessionRow>(
          `SELECT s.id, s.conversation_id, s.agent_id, s.binding_id,
                  b.external_agent_id, s.external_session_ref
             FROM agent_world.conversation_sessions s
             JOIN agent_world.runtime_bindings b
               ON b.id = s.binding_id
              AND b.agent_id = s.agent_id
              AND b.adapter_kind = s.adapter_kind
             JOIN agent_world.execution_routes r ON r.id = b.route_id
             JOIN agent_world.agents a ON a.id = s.agent_id
            WHERE s.adapter_kind = 'OPENCLAW'
              AND s.ended_at IS NULL
              AND b.is_enabled = true
              AND r.is_enabled = true
              AND a.is_enabled = true
            ORDER BY s.id
            LIMIT $1`,
          [MAX_MESSAGE_SESSIONS + 1],
        ),
      ]);
      if (
        agentsResult.rows.length > MAX_AGENTS ||
        bindingsResult.rows.length > MAX_BINDINGS ||
        messageSessionsResult.rows.length > MAX_MESSAGE_SESSIONS
      ) {
        throw new Error("Canonical OpenClaw configuration exceeds the bounded runtime limit");
      }
      const agents = agentsResult.rows.map((row) =>
        AgentSchema.parse({
          schemaVersion: 1,
          id: row.id,
          slug: row.slug,
          displayName: row.display_name,
          role: row.role,
          instructions: row.instructions,
          isEnabled: row.is_enabled,
        }),
      );
      const agentIds = new Set(agents.map(({ id }) => id));
      const bindings = bindingsResult.rows.map(
        (row): OpenClawCanonicalBinding => ({
          agentId: AgentSchema.shape.id.parse(row.agent_id),
          bindingId: BindingIdSchema.parse(row.id),
          externalAgentId: parseExternalAgentId(row.external_agent_id),
          displayName: AgentSchema.shape.displayName.parse(row.display_name),
        }),
      );
      if (bindings.some(({ agentId }) => !agentIds.has(agentId))) {
        throw new Error("OpenClaw binding references an Agent outside canonical configuration");
      }
      assertUniqueBindings(bindings);
      const messageSessions = messageSessionsResult.rows.map(
        (row): OpenClawMessageSession => ({
          conversationId: ConversationIdSchema.parse(row.conversation_id),
          sessionId: SessionIdSchema.parse(row.id),
          agentId: AgentSchema.shape.id.parse(row.agent_id),
          bindingId: BindingIdSchema.parse(row.binding_id),
          externalAgentId: parseExternalAgentId(row.external_agent_id),
          externalSessionKey: OpaqueExternalIdSchema.parse(row.external_session_ref),
        }),
      );
      const bindingKeys = new Set(
        bindings.map(({ agentId, bindingId, externalAgentId }) =>
          JSON.stringify([agentId, bindingId, externalAgentId]),
        ),
      );
      if (
        messageSessions.some(
          ({ agentId, bindingId, externalAgentId }) =>
            !bindingKeys.has(JSON.stringify([agentId, bindingId, externalAgentId])),
        )
      ) {
        throw new Error("OpenClaw message session references a disabled canonical binding");
      }
      return { agents, bindings, messageSessions };
    } finally {
      client.release();
    }
  }
}
