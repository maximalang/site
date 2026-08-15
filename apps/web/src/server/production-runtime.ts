import { randomUUID } from "node:crypto";
import { CodexTaskExecutionAdapter } from "@agent-world/codex-adapter";
import { ConversationSendService, TaskDispatchService } from "@agent-world/conversation-service";
import { ContextItemIdSchema, EventIdSchema, RunIdSchema } from "@agent-world/domain";
import { GraphitiMemoryAdapter, HttpGraphitiMcpTransport } from "@agent-world/graphiti-adapter";
import { LiteLlmModelGateway, LiteLlmProjectionReconciler } from "@agent-world/model-gateway";
import {
  type OpenClawCredential,
  OpenClawReadAdapter,
  OpenClawWriteAdapter,
} from "@agent-world/openclaw-adapter";
import {
  createProductionMissionWorkflow,
  type ProductionMissionWorkflow,
} from "@agent-world/orchestration";
import {
  applyMigrations,
  discoverMigrations,
  MemoryGraphProjector,
  PostgresAgentConversationReader,
  PostgresApprovalRunStore,
  PostgresCodexBindingResolver,
  PostgresCodexExecutionStore,
  PostgresConversationReader,
  PostgresConversationStore,
  PostgresEncryptedSecretStore,
  PostgresExecutionPreferenceStore,
  PostgresHubCommandStore,
  PostgresHubReader,
  PostgresIntegrationStore,
  PostgresMemoryCenterReader,
  PostgresMemoryCurationStore,
  PostgresMemoryProjectionStore,
  PostgresMissionHandoffStore,
  PostgresMissionStore,
  PostgresModelRouteResolver,
  PostgresNativeChatControlStore,
  PostgresNativeChatLaunchStore,
  PostgresNativeChatResourceReader,
  PostgresOpenClawConfigurationReader,
  PostgresOperationsReader,
  PostgresOwnerSessionStore,
  PostgresRunContextPackProvider,
  PostgresRunDispatchStore,
  PostgresRunProvenanceReader,
  PostgresRuntimeMessageStore,
  PostgresScheduleStore,
  PostgresWorldProjectionStore,
  RouteResolutionError,
  SecretStoreError,
} from "@agent-world/postgres-store";
import { ModelRouteCheckResponseSchema } from "@agent-world/read-model";
import { nextOccurrence } from "@agent-world/scheduler";
import { Pool, type PoolConfig } from "pg";
import type { ApplicationRuntime } from "./application-runtime";
import { MemoryProjectionSupervisor } from "./memory-projection-supervisor";
import { MissionHandoffSupervisor } from "./mission-handoff-supervisor";
import { NativeChatReconciliationSupervisor } from "./native-chat-reconciliation-supervisor";
import { OwnerSessionManager } from "./owner-session";
import { ScheduleSupervisor } from "./schedule-supervisor";
import { TaskRunSupervisor } from "./task-run-supervisor";

type RuntimeEnvironment = Record<string, string | undefined>;

type OpenClawRuntimeConfig = {
  endpoint: string;
  credential: OpenClawCredential;
  instanceId: string;
};

export function parseSecretKeyMaterial(environment: RuntimeEnvironment): {
  keyVersion: number;
  masterKey: Buffer;
} {
  const encoded = environment.AGENT_WORLD_SECRET_MASTER_KEY;
  const version = Number(environment.AGENT_WORLD_SECRET_KEY_VERSION);
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    throw new Error("AGENT_WORLD_SECRET_MASTER_KEY must be a 32-byte base64url value");
  }
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new Error("AGENT_WORLD_SECRET_KEY_VERSION must be a positive integer");
  }
  const masterKey = Buffer.from(encoded, "base64url");
  if (masterKey.byteLength !== 32 || masterKey.toString("base64url") !== encoded) {
    throw new Error("AGENT_WORLD_SECRET_MASTER_KEY is not canonical base64url");
  }
  return { keyVersion: version, masterKey };
}

function loopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function parseDatabasePoolConfig(environment: RuntimeEnvironment): PoolConfig {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString || connectionString.length > 4_096) {
    throw new Error("DATABASE_URL is required and must be bounded");
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be an absolute PostgreSQL URL");
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("DATABASE_URL violates the production connection contract");
  }
  const tlsMode = environment.AGENT_WORLD_DATABASE_TLS;
  if (tlsMode !== "verify-full" && tlsMode !== "disable") {
    throw new Error("AGENT_WORLD_DATABASE_TLS must be verify-full or disable");
  }
  if (
    tlsMode === "disable" &&
    !loopback(url.hostname) &&
    environment.AGENT_WORLD_DATABASE_PLAINTEXT_ACK !== "private-network"
  ) {
    throw new Error("Plaintext PostgreSQL requires an explicit private-network acknowledgement");
  }
  return {
    connectionString,
    ssl: tlsMode === "verify-full" ? { rejectUnauthorized: true } : false,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "agent-world-web",
  };
}

function parseOpenClawRuntimeConfig(
  environment: RuntimeEnvironment,
): OpenClawRuntimeConfig | undefined {
  const endpoint = environment.OPENCLAW_GATEWAY_URL;
  const token = environment.OPENCLAW_GATEWAY_TOKEN;
  const deviceToken = environment.OPENCLAW_GATEWAY_DEVICE_TOKEN;
  if (!endpoint && !token && !deviceToken) {
    return undefined;
  }
  if (!endpoint || (!token && !deviceToken) || (token && deviceToken)) {
    throw new Error("OpenClaw configuration is incomplete or ambiguous");
  }
  const credential: OpenClawCredential = token
    ? { kind: "TOKEN", value: token }
    : deviceToken
      ? { kind: "DEVICE_TOKEN", value: deviceToken }
      : (() => {
          throw new Error("OpenClaw credential is missing");
        })();
  return {
    endpoint,
    credential,
    instanceId: environment.AGENT_WORLD_INSTANCE_ID ?? "agent-world",
  };
}

function parseLiteLlmConfig(
  environment: RuntimeEnvironment,
): { baseUrl: string; masterKey: string } | undefined {
  const baseUrl = environment.LITELLM_BASE_URL;
  const masterKey = environment.LITELLM_MASTER_KEY;
  if (!baseUrl && !masterKey) return undefined;
  if (!baseUrl || !masterKey || masterKey.length < 16 || masterKey.length > 4_096) {
    throw new Error("LiteLLM configuration is incomplete");
  }
  return { baseUrl, masterKey };
}

function record(component: string, event: unknown): void {
  try {
    const serialized = JSON.stringify({ component, event });
    console.info(
      serialized.length <= 4_096 ? serialized : JSON.stringify({ component, event: "oversized" }),
    );
  } catch {
    // Telemetry must never interrupt runtime lifecycle.
  }
}

export async function createProductionRuntime(
  environment: RuntimeEnvironment = process.env,
): Promise<ApplicationRuntime> {
  const pool = new Pool(parseDatabasePoolConfig(environment));
  pool.on("error", () => record("postgres", { event: "unexpected_idle_client_error" }));
  let readAdapter: OpenClawReadAdapter | undefined;
  let writeAdapter: OpenClawWriteAdapter | undefined;
  let taskRunSupervisor: TaskRunSupervisor | undefined;
  let memoryProjectionSupervisor: MemoryProjectionSupervisor | undefined;
  let missionHandoffSupervisor: MissionHandoffSupervisor | undefined;
  let nativeChatReconciliationSupervisor: NativeChatReconciliationSupervisor | undefined;
  let scheduleSupervisor: ScheduleSupervisor | undefined;
  let missionCheckpointPool: Pool | undefined;
  let missionWorkflow: ProductionMissionWorkflow | undefined;
  try {
    const migrationClient = await pool.connect();
    try {
      await migrationClient.query("SELECT 1");
      await applyMigrations(migrationClient, await discoverMigrations());
    } finally {
      migrationClient.release();
    }

    const ownerSessionStore = new PostgresOwnerSessionStore(pool);
    await ownerSessionStore.pruneExpiredSessions(new Date().toISOString());
    const auth = new OwnerSessionManager({
      store: ownerSessionStore,
      passwordHash: environment.AGENT_WORLD_OWNER_PASSWORD_HASH,
      csrfSecret: environment.AGENT_WORLD_CSRF_SECRET,
      secureCookies: environment.NODE_ENV === "production",
    });

    const agentConversationReader = new PostgresAgentConversationReader(pool);
    const conversationReader = new PostgresConversationReader(pool);
    const conversationStore = new PostgresConversationStore(pool);
    const missionStore = new PostgresMissionStore(pool, {
      eventId: () => EventIdSchema.parse(`event_${randomUUID()}`),
    });
    const scheduleStore = new PostgresScheduleStore(pool, nextOccurrence, {
      taskId: () => `task_${randomUUID()}`,
      firingId: () => `schedule_firing_${randomUUID()}`,
      eventId: () => `event_${randomUUID()}`,
    });
    scheduleSupervisor = new ScheduleSupervisor({
      store: scheduleStore,
      record: (event) => record("schedule-supervisor", event),
      intervalMs: Number(environment.AGENT_WORLD_SCHEDULE_POLL_MS ?? "30000"),
    });
    scheduleSupervisor.start();
    missionCheckpointPool = new Pool({
      ...parseDatabasePoolConfig(environment),
      application_name: "agent-world-langgraph",
      max: 4,
    });
    missionWorkflow = await createProductionMissionWorkflow(missionCheckpointPool, missionStore);
    const activeMissionWorkflow = missionWorkflow;
    const hubReader = new PostgresHubReader(pool);
    const operationsReader = new PostgresOperationsReader(pool);
    const integrationStore = new PostgresIntegrationStore(pool);
    const hubCommandStore = new PostgresHubCommandStore(pool);
    const memoryReader = new PostgresMemoryCenterReader(pool);
    const memoryStore = new PostgresMemoryCurationStore(pool, {
      contextItemId: () => ContextItemIdSchema.parse(`context_item_${randomUUID()}`),
      eventId: () => EventIdSchema.parse(`event_${randomUUID()}`),
    });
    const graphitiEndpoint = environment.AGENT_WORLD_GRAPHITI_MCP_URL?.trim();
    if (graphitiEndpoint) {
      try {
        const pollMs = Number(environment.AGENT_WORLD_GRAPHITI_POLL_MS ?? "5000");
        const adapter = new GraphitiMemoryAdapter(
          new HttpGraphitiMcpTransport({
            endpoint: graphitiEndpoint,
            ...(environment.AGENT_WORLD_GRAPHITI_PLAINTEXT_ACK
              ? {
                  plaintextPrivateNetworkAck: environment.AGENT_WORLD_GRAPHITI_PLAINTEXT_ACK,
                }
              : {}),
          }),
        );
        const projector = new MemoryGraphProjector(
          new PostgresMemoryProjectionStore(pool),
          adapter,
          { projectionName: "graphiti-memory-v1" },
        );
        memoryProjectionSupervisor = new MemoryProjectionSupervisor({
          projector,
          intervalMs: pollMs,
          record: (event) => record("memory-projection-supervisor", event),
        });
        memoryProjectionSupervisor.start();
      } catch {
        record("memory-projection-supervisor", { event: "configuration_rejected" });
      }
    }
    const secretStore = new PostgresEncryptedSecretStore(pool, parseSecretKeyMaterial(environment));
    const routeResolver = new PostgresModelRouteResolver(pool, {
      allowedLocalOrigins: (environment.AGENT_WORLD_LOCAL_MODEL_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    });
    const liteLlmConfig = parseLiteLlmConfig(environment);
    const modelGateway = liteLlmConfig
      ? new LiteLlmModelGateway({
          baseUrl: liteLlmConfig.baseUrl,
          credentialProvider: async () => liteLlmConfig.masterKey,
          routeResolver: async (modelRouteId) => {
            const route = await routeResolver.resolve(modelRouteId);
            return { modelRouteId: route.modelRouteId, modelAlias: route.modelAlias };
          },
        })
      : undefined;
    const projectionReconciler = liteLlmConfig
      ? new LiteLlmProjectionReconciler({
          baseUrl: liteLlmConfig.baseUrl,
          credentialProvider: async () => liteLlmConfig.masterKey,
        })
      : undefined;
    const reconcileModelRoutes = async () => {
      if (!projectionReconciler) return;
      for (const modelRouteId of await routeResolver.listCandidateRouteIds()) {
        try {
          const route = await routeResolver.resolve(modelRouteId);
          const credential = route.credentialRef
            ? await secretStore.read(route.credentialRef, "PROVIDER_API_KEY")
            : route.providerKind === "LM_STUDIO"
              ? "local-model-no-secret"
              : undefined;
          await projectionReconciler.reconcile({
            modelRouteId: route.modelRouteId,
            modelAlias: route.modelAlias,
            providerModel: route.providerModel,
            ...(route.apiBase === undefined ? {} : { apiBase: route.apiBase }),
            ...(credential === undefined ? {} : { credential }),
          });
        } catch (error) {
          if (error instanceof RouteResolutionError || error instanceof SecretStoreError) continue;
          throw error;
        }
      }
    };
    await reconcileModelRoutes();
    const executionPreferenceStore = new PostgresExecutionPreferenceStore(pool);
    const runtimeMessageStore = new PostgresRuntimeMessageStore(pool, {
      messageId: () => `message_${randomUUID()}`,
    });
    const configuration = await new PostgresOpenClawConfigurationReader(pool).read();
    const runtimeObservationId = randomUUID();
    const worldStore = new PostgresWorldProjectionStore(pool, {
      eventId: () => `event_${randomUUID()}`,
    });
    const approvalStore = new PostgresApprovalRunStore(pool, {
      eventId: () => `event_${randomUUID()}`,
    });
    const runDispatchStore = new PostgresRunDispatchStore(pool, {
      eventId: () => `event_${randomUUID()}`,
    });
    const nativeChatControlStore = new PostgresNativeChatControlStore(pool, {
      eventId: () => `event_${randomUUID()}`,
      contextItemId: () => `context_item_${randomUUID()}`,
      memoryProposalId: () => `memory_proposal_${randomUUID()}`,
      memoryEventId: () => `event_${randomUUID()}`,
    });
    nativeChatReconciliationSupervisor = new NativeChatReconciliationSupervisor({
      store: nativeChatControlStore,
      record: (event) => record("native-chat-reconciliation-supervisor", event),
    });
    nativeChatReconciliationSupervisor.start();
    const nativeChatLaunchStore = new PostgresNativeChatLaunchStore(pool);
    const nativeChatResourceReader = new PostgresNativeChatResourceReader(pool, {
      pullId: () => `resource_pull_${randomUUID()}`,
    });
    const runProvenanceReader = new PostgresRunProvenanceReader(pool);
    const codexAdapter = new CodexTaskExecutionAdapter({
      resolver: new PostgresCodexBindingResolver(pool),
      dispatcher: new PostgresCodexExecutionStore(pool, {
        executionId: () => `codex_execution_${randomUUID()}`,
      }),
    });
    if (configuration.bindings.length > 0) {
      await worldStore.applyOpenClawSnapshot({
        observedAt: new Date().toISOString(),
        observationId: `openclaw-start:${runtimeObservationId}`,
        statuses: configuration.bindings.map(({ agentId, bindingId }) => ({
          agentId,
          bindingId,
          status: "OFFLINE",
        })),
      });
    }

    let openClawConfig: OpenClawRuntimeConfig | undefined;
    try {
      openClawConfig = parseOpenClawRuntimeConfig(environment);
    } catch {
      record("openclaw", { event: "configuration_rejected" });
    }

    if (openClawConfig) {
      try {
        const activeOpenClawConfig = openClawConfig;
        const credentialProvider = async () => activeOpenClawConfig.credential;
        readAdapter = new OpenClawReadAdapter({
          config: {
            endpoint: openClawConfig.endpoint,
            clientVersion: "0.0.0",
            instanceId: `${openClawConfig.instanceId}.read`,
          },
          bindings: configuration.bindings,
          messageSessions: configuration.messageSessions,
          credentialProvider,
          telemetry: { record: (event) => record("openclaw-read", event) },
          onSnapshot: (snapshot) =>
            worldStore.applyOpenClawSnapshot({
              observedAt: snapshot.runtime.receivedAt,
              observationId: `openclaw-observation:${runtimeObservationId}:${snapshot.sourceCursor.connectionEpoch}:${snapshot.sourceCursor.connectionSequence ?? "snapshot"}:${randomUUID()}`,
              statuses: snapshot.runtime.agents.map(({ agentId, bindingId, status }) => ({
                agentId,
                bindingId,
                status,
              })),
            }),
          onReceivedHistory: async (history) => {
            await runtimeMessageStore.receiveOpenClawHistory(history);
          },
          correlationId: "openclaw-read-runtime",
        });
        writeAdapter = new OpenClawWriteAdapter({
          config: {
            endpoint: openClawConfig.endpoint,
            clientVersion: "0.0.0",
            instanceId: `${openClawConfig.instanceId}.write`,
          },
          credentialProvider,
          telemetry: { record: (event) => record("openclaw-write", event) },
          correlationId: "openclaw-write-runtime",
        });
        await Promise.all([readAdapter.start(), writeAdapter.start()]);
      } catch {
        await Promise.allSettled([readAdapter?.stop(), writeAdapter?.stop()]);
        readAdapter = undefined;
        writeAdapter = undefined;
        record("openclaw", { event: "adapter_start_rejected" });
      }
    }

    const sender = new ConversationSendService({
      store: conversationStore,
      adapters: {
        resolve: (kind) =>
          kind === "OPENCLAW" && writeAdapter?.state === "READY" ? writeAdapter : undefined,
      },
    });
    const taskDispatcher = new TaskDispatchService({
      store: runDispatchStore,
      contextPacks: new PostgresRunContextPackProvider(pool, {
        packId: () => `context_pack_${randomUUID()}`,
      }),
      adapters: {
        resolve: (kind) => {
          if (kind === "CODEX") return codexAdapter;
          return kind === "OPENCLAW" && writeAdapter?.state === "READY" ? writeAdapter : undefined;
        },
      },
    });
    taskRunSupervisor = new TaskRunSupervisor({
      source: runDispatchStore,
      observer: taskDispatcher,
      telemetry: { record: (event) => record("task-run-supervisor", event) },
    });
    taskRunSupervisor.start();
    const missionHandoffStore = new PostgresMissionHandoffStore(pool, {
      eventId: () => `event_${randomUUID()}`,
    });
    missionHandoffSupervisor = new MissionHandoffSupervisor({
      store: missionHandoffStore,
      approve: ({ taskId, approvalId }, decidedAt) =>
        approvalStore.decide({
          taskId,
          approvalId,
          decision: "APPROVE",
          commandId: `mission-auto-approve:${taskId.slice("task_".length)}`,
          decidedAt,
        }),
      record: (event) => record("mission-handoff-supervisor", event),
      intervalMs: Number(environment.AGENT_WORLD_MISSION_HANDOFF_POLL_MS ?? "5000"),
    });
    missionHandoffSupervisor.start();

    return {
      auth,
      probeReady: async () => {
        await pool.query("SELECT 1");
        if (modelGateway) {
          const gatewayHealth = await modelGateway.health();
          if (gatewayHealth.status !== "READY") throw new Error("Model gateway is not ready");
        }
      },
      readAgentConversations: (agentId) => agentConversationReader.read(agentId),
      readConversation: (input) => conversationReader.read(input),
      sendConversation: (input) => sender.send(input),
      assignTask: (input) => worldStore.assignTask(input),
      advanceMissionWorkflow: (missionId) => activeMissionWorkflow.advance(missionId),
      createMissionDecomposition: async (input, materializedAt) => {
        const proposal = await missionStore.createDecomposition(input);
        const materialization = await missionStore.materializeDecomposition(
          input.id,
          materializedAt,
        );
        return { proposal: proposal.outcome, materialization };
      },
      recordMissionMeeting: (input) => missionStore.recordMeeting(input),
      createSchedule: (input, createdAt) => {
        const nextFireAt = input.isEnabled
          ? nextOccurrence({
              expression: input.cronExpression,
              timezone: input.timezone,
              after: createdAt,
            })
          : undefined;
        return scheduleStore.create({
          schemaVersion: 1,
          ...input,
          ...(nextFireAt === undefined ? {} : { nextFireAt }),
          createdAt,
          updatedAt: createdAt,
        });
      },
      readSchedules: (limit) => scheduleStore.list(limit),
      decideApproval: async (input) => {
        const decision = await approvalStore.decide(input);
        if (decision.approval.type !== "APPROVED") {
          return { ...decision, dispatch: "NOT_APPLICABLE" as const };
        }
        if (!decision.run) throw new Error("Approved decision is missing its canonical Run");
        const execution = await runProvenanceReader.read(decision.run.id);
        try {
          const dispatched = await taskDispatcher.dispatch(decision.run.id);
          return { ...decision, run: dispatched.run, execution, dispatch: dispatched.outcome };
        } catch {
          return { ...decision, execution, dispatch: "PENDING" as const };
        }
      },
      appendNativeChatControl: (accountId, event) =>
        nativeChatControlStore.append(accountId, event),
      pullNativeChatResources: (accountId, request) =>
        nativeChatResourceReader.pull(accountId, request),
      executeHubCommand: (command) => hubCommandStore.execute(command),
      readNativeChatBrowserProfiles: () => nativeChatLaunchStore.listProfiles(),
      configureNativeChatBrowserProfile: (input) => nativeChatLaunchStore.configureProfile(input),
      writeProviderCredential: async (input) => {
        const receipt = await secretStore.writeProviderCredential(input);
        await reconcileModelRoutes();
        return receipt;
      },
      checkModelRoute: async (modelRouteId) => {
        if (!modelGateway) throw new Error("Model gateway is unavailable");
        const route = await routeResolver.resolve(modelRouteId);
        const runId = RunIdSchema.parse(`run_${randomUUID()}`);
        const result = await modelGateway.complete({
          schemaVersion: 1,
          runId,
          modelRouteId,
          messages: [{ role: "USER", content: "Reply with exactly: OK" }],
          maxOutputTokens: 16,
          temperature: 0,
          timeoutMs: 60_000,
          idempotencyKey: `route-check-${runId}`,
        });
        return ModelRouteCheckResponseSchema.parse({
          schemaVersion: 1,
          runId,
          modelRouteId,
          providerId: route.providerId,
          ...(route.accountId === undefined ? {} : { accountId: route.accountId }),
          mode: route.mode,
          remoteModelId: route.remoteModelId,
          status: "SUCCEEDED",
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          },
        });
      },
      readExecutionPreferences: (selection) => executionPreferenceStore.read(selection),
      writeExecutionPreferences: (layer, updatedAt) =>
        executionPreferenceStore.writeLayer(layer, updatedAt),
      readMemoryInbox: (projectId, limit) => memoryReader.inbox(projectId, limit),
      readMemoryTimeline: (projectId, limit) => memoryReader.timeline(projectId, limit),
      readMemoryNetwork: (projectId, limit) => memoryReader.network(projectId, limit),
      decideMemory: (input) => memoryStore.decide(input),
      readHub: () => hubReader.read(),
      readOperations: () => operationsReader.read(),
      readIntegrations: () => integrationStore.list(),
      createIntegration: (input) => integrationStore.create(input),
      writeIntegrationCredential: async (input) => {
        const secretRef = `secret-store:integrations/${input.integrationId}/credential`;
        const receipt = await secretStore.write({
          commandId: input.commandId,
          secretRef,
          purpose: "INTEGRATION_CREDENTIAL",
          plaintext: input.plaintext,
          writtenAt: input.writtenAt,
        });
        await integrationStore.bindCredential(input.integrationId, secretRef, input.writtenAt);
        return receipt;
      },
      readWorld: () => worldStore.readWorld(configuration.agents),
      stop: async () => {
        await taskRunSupervisor?.stop();
        await memoryProjectionSupervisor?.stop();
        await missionHandoffSupervisor?.stop();
        await nativeChatReconciliationSupervisor?.stop();
        await scheduleSupervisor?.stop();
        await missionWorkflow?.stop();
        await Promise.allSettled([readAdapter?.stop(), writeAdapter?.stop()]);
        await pool.end();
      },
    };
  } catch (error) {
    await taskRunSupervisor?.stop();
    await memoryProjectionSupervisor?.stop();
    await missionHandoffSupervisor?.stop();
    await nativeChatReconciliationSupervisor?.stop();
    await scheduleSupervisor?.stop();
    if (missionWorkflow) {
      await missionWorkflow.stop().catch(() => undefined);
    } else {
      await missionCheckpointPool?.end().catch(() => undefined);
    }
    await Promise.allSettled([readAdapter?.stop(), writeAdapter?.stop()]);
    await pool.end().catch(() => undefined);
    throw error;
  }
}
