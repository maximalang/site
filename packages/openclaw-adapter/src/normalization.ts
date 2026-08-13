import {
  type AgentId,
  AgentIdSchema,
  type AgentStatus,
  AgentStatusSchema,
  type BindingId,
  BindingIdSchema,
  OpaqueExternalIdSchema,
} from "@agent-world/domain";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import * as z from "zod";

const MAX_RUNTIME_ROWS = 1_000;
const TimestampSchema = z.iso.datetime();
const EpochMsSchema = z.number().int().nonnegative();
const ExternalAgentIdSchema = OpaqueExternalIdSchema.max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  "OpenClaw Agent IDs must be safe routing identifiers",
);

export const OpenClawBoundAgentSchema = z.strictObject({
  agentId: AgentIdSchema,
  bindingId: BindingIdSchema,
  externalAgentId: ExternalAgentIdSchema,
  displayName: z.string().trim().min(1).max(100),
});
export type OpenClawBoundAgent = z.infer<typeof OpenClawBoundAgentSchema>;

const OpenClawAgentSummarySchema = z.object({
  id: ExternalAgentIdSchema,
  kind: z.enum(["agent", "system"]).optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

export const OpenClawAgentsListResultSchema = z.object({
  defaultId: ExternalAgentIdSchema,
  mainKey: OpaqueExternalIdSchema,
  scope: z.enum(["per-sender", "global"]),
  agents: z.array(OpenClawAgentSummarySchema).max(MAX_RUNTIME_ROWS),
});
export type OpenClawAgentsListResult = z.infer<typeof OpenClawAgentsListResultSchema>;

const OpenClawSessionStatusSchema = z.enum(["running", "done", "failed", "killed", "timeout"]);

const OpenClawSessionRowSchema = z.object({
  key: OpaqueExternalIdSchema,
  agentId: ExternalAgentIdSchema.optional(),
  sessionId: OpaqueExternalIdSchema.optional(),
  kind: z.enum(["direct", "group", "global", "unknown"]),
  updatedAt: EpochMsSchema.nullable(),
  status: OpenClawSessionStatusSchema.optional(),
  hasActiveRun: z.boolean().optional(),
  activeRunIds: z.array(OpaqueExternalIdSchema).max(100).optional(),
});
export type OpenClawSessionRow = z.infer<typeof OpenClawSessionRowSchema>;

export const OpenClawSessionsListResultSchema = z.object({
  ts: EpochMsSchema,
  path: z.string().max(2_048),
  count: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative().optional(),
  hasMore: z.boolean().optional(),
  defaults: z.object({}),
  sessions: z.array(OpenClawSessionRowSchema).max(MAX_RUNTIME_ROWS),
});
export type OpenClawSessionsListResult = z.infer<typeof OpenClawSessionsListResultSchema>;

const OpenClawPresenceEntrySchema = z.object({
  mode: z.string().trim().min(1).max(64).optional(),
  reason: z.string().trim().min(1).max(128).optional(),
  text: z.string().max(2_048).optional(),
  ts: EpochMsSchema,
  deviceId: OpaqueExternalIdSchema.optional(),
  instanceId: OpaqueExternalIdSchema.optional(),
});

export const OpenClawPresenceResultSchema = z.array(OpenClawPresenceEntrySchema).max(200);
export type OpenClawPresenceResult = z.infer<typeof OpenClawPresenceResultSchema>;

export type OpenClawRuntimeSession = {
  agentId: AgentId;
  bindingId: BindingId;
  externalAgentId: string;
  externalSessionKey: string;
  externalSessionId?: string;
  status?: z.infer<typeof OpenClawSessionStatusSchema>;
  hasActiveRun: boolean;
  activeRunIds: string[];
  updatedAt: number | null;
};

export type OpenClawRuntimeAgent = OpenClawBoundAgent & {
  isRuntimeConfigured: boolean;
  sessionCount: number;
  latestActivityAt: number | null;
  activeRunIds: string[];
  status: AgentStatus;
};

export type OpenClawGatewayPresence = {
  externalPresenceId?: string;
  mode?: string;
  reason?: string;
  observedAt: number;
};

export type OpenClawRuntimeSnapshot = {
  schemaVersion: 1;
  adapterKind: "OPENCLAW";
  protocolVersion: number;
  receivedAt: string;
  agents: OpenClawRuntimeAgent[];
  sessions: OpenClawRuntimeSession[];
  presence: OpenClawGatewayPresence[];
  ignoredUnboundAgentCount: number;
};

export function createOfflineOpenClawSnapshot(
  bindingsInput: unknown,
  receivedAtInput: unknown,
): OpenClawRuntimeSnapshot {
  const bindings = z.array(OpenClawBoundAgentSchema).max(MAX_RUNTIME_ROWS).parse(bindingsInput);
  const receivedAt = TimestampSchema.parse(receivedAtInput);
  assertUniqueBindings(bindings);

  return {
    schemaVersion: 1,
    adapterKind: "OPENCLAW",
    protocolVersion: PROTOCOL_VERSION,
    receivedAt,
    agents: bindings
      .map((binding) => ({
        ...binding,
        isRuntimeConfigured: false,
        sessionCount: 0,
        latestActivityAt: null,
        activeRunIds: [],
        status: AgentStatusSchema.parse("OFFLINE"),
      }))
      .sort((left, right) => left.externalAgentId.localeCompare(right.externalAgentId)),
    sessions: [],
    presence: [],
    ignoredUnboundAgentCount: 0,
  };
}

type NormalizeOpenClawSnapshotInput = {
  bindings: unknown;
  receivedAt: unknown;
  agents: unknown;
  sessions: unknown;
  presence: unknown;
};

function assertUniqueBindings(bindings: OpenClawBoundAgent[]): void {
  const externalIds = new Set<string>();
  const canonicalIds = new Set<AgentId>();
  const bindingIds = new Set<BindingId>();

  for (const binding of bindings) {
    if (externalIds.has(binding.externalAgentId)) {
      throw new Error(`Duplicate OpenClaw externalAgentId: ${binding.externalAgentId}`);
    }
    if (canonicalIds.has(binding.agentId)) {
      throw new Error(`Duplicate canonical Agent binding: ${binding.agentId}`);
    }
    if (bindingIds.has(binding.bindingId)) {
      throw new Error(`Duplicate RuntimeBinding identity: ${binding.bindingId}`);
    }
    externalIds.add(binding.externalAgentId);
    canonicalIds.add(binding.agentId);
    bindingIds.add(binding.bindingId);
  }
}

function resolveSessionBinding(
  session: OpenClawSessionRow,
  bindingsByExternalId: Map<string, OpenClawBoundAgent>,
): OpenClawBoundAgent | undefined {
  if (session.agentId) {
    return bindingsByExternalId.get(session.agentId);
  }

  for (const [externalAgentId, binding] of bindingsByExternalId) {
    if (session.key.startsWith(`agent:${externalAgentId}:`)) {
      return binding;
    }
  }
  return undefined;
}

function statusFromSessions(
  isRuntimeConfigured: boolean,
  sessions: OpenClawRuntimeSession[],
): AgentStatus {
  if (!isRuntimeConfigured) {
    return AgentStatusSchema.parse("OFFLINE");
  }
  if (sessions.some((session) => session.hasActiveRun || session.status === "running")) {
    return AgentStatusSchema.parse("RUNNING");
  }

  const latest = sessions
    .filter((session) => session.updatedAt !== null)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];
  if (latest?.status === "failed" || latest?.status === "timeout") {
    return AgentStatusSchema.parse("FAILED");
  }
  return AgentStatusSchema.parse("IDLE");
}

export function normalizeOpenClawSnapshot(
  input: NormalizeOpenClawSnapshotInput,
): OpenClawRuntimeSnapshot {
  const bindings = z.array(OpenClawBoundAgentSchema).max(MAX_RUNTIME_ROWS).parse(input.bindings);
  const receivedAt = TimestampSchema.parse(input.receivedAt);
  const agentsResult = OpenClawAgentsListResultSchema.parse(input.agents);
  const sessionsResult = OpenClawSessionsListResultSchema.parse(input.sessions);
  const presenceResult = OpenClawPresenceResultSchema.parse(input.presence);
  assertUniqueBindings(bindings);

  const bindingsByExternalId = new Map(
    bindings.map((binding) => [binding.externalAgentId, binding] as const),
  );
  const runtimeAgentIds = new Set(
    agentsResult.agents.filter((agent) => agent.kind !== "system").map((agent) => agent.id),
  );

  const sessions = sessionsResult.sessions
    .map((session): OpenClawRuntimeSession | undefined => {
      const binding = resolveSessionBinding(session, bindingsByExternalId);
      if (!binding) {
        return undefined;
      }
      return {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        externalAgentId: binding.externalAgentId,
        externalSessionKey: session.key,
        ...(session.sessionId ? { externalSessionId: session.sessionId } : {}),
        ...(session.status ? { status: session.status } : {}),
        hasActiveRun: session.hasActiveRun === true,
        activeRunIds: [...(session.activeRunIds ?? [])].sort(),
        updatedAt: session.updatedAt,
      };
    })
    .filter((session): session is OpenClawRuntimeSession => session !== undefined)
    .sort((left, right) => left.externalSessionKey.localeCompare(right.externalSessionKey));

  const agents = bindings
    .map((binding): OpenClawRuntimeAgent => {
      const agentSessions = sessions.filter((session) => session.agentId === binding.agentId);
      const latestActivityAt = agentSessions.reduce<number | null>(
        (latest, session) =>
          session.updatedAt !== null && (latest === null || session.updatedAt > latest)
            ? session.updatedAt
            : latest,
        null,
      );
      const activeRunIds = [
        ...new Set(agentSessions.flatMap((session) => session.activeRunIds)),
      ].sort();
      const isRuntimeConfigured = runtimeAgentIds.has(binding.externalAgentId);

      return {
        ...binding,
        isRuntimeConfigured,
        sessionCount: agentSessions.length,
        latestActivityAt,
        activeRunIds,
        status: statusFromSessions(isRuntimeConfigured, agentSessions),
      };
    })
    .sort((left, right) => left.externalAgentId.localeCompare(right.externalAgentId));

  const ignoredUnboundAgentCount = agentsResult.agents.filter(
    (agent) => agent.kind !== "system" && !bindingsByExternalId.has(agent.id),
  ).length;

  return {
    schemaVersion: 1,
    adapterKind: "OPENCLAW",
    protocolVersion: PROTOCOL_VERSION,
    receivedAt,
    agents,
    sessions,
    presence: presenceResult
      .map((entry): OpenClawGatewayPresence => {
        const externalPresenceId = entry.deviceId ?? entry.instanceId;
        return {
          ...(externalPresenceId ? { externalPresenceId } : {}),
          ...(entry.mode ? { mode: entry.mode } : {}),
          ...(entry.reason ? { reason: entry.reason } : {}),
          observedAt: entry.ts,
        };
      })
      .sort((left, right) => left.observedAt - right.observedAt),
    ignoredUnboundAgentCount,
  };
}
