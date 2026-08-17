import type { ConversationSendResult } from "@agent-world/conversation-service";
import type {
  AccountId,
  AgentId,
  AgentSchedule,
  MemoryCurationDecision,
  RagIngestionRequest,
  Mission,
  MissionDecomposition,
  MissionId,
  ModelRouteId,
  NativeChatBrowserProfileConfiguration,
  NativeChatBrowserProfileConfigurationInput,
  NativeChatBrowserProfileList,
  NativeChatControlEventInput,
  NativeChatPullRequest,
  NativeChatPullResponse,
  SendMessageIntent,
  StructuredMeeting,
} from "@agent-world/domain";
import type { ProductionMissionWorkflowResult } from "@agent-world/orchestration";
import type {
  ApprovalDecisionInput,
  AssignTaskInput,
  ConversationReadInput,
  ProviderCredentialWriteInput,
  SecretWriteReceipt,
} from "@agent-world/postgres-store";
import type {
  ExecutionPreferenceLayer,
  ExecutionPreferenceReadModel,
  ExecutionPreferenceSelection,
  HubCommandRequest,
  HubCommandResponse,
  HubReadModel,
  IntegrationAction,
  IntegrationCreate,
  IntegrationMutation,
  IntegrationRegistry,
  IntegrationSshOperationCreate,
  IntegrationToolAllowlistCreate,
  ModelRouteCheckResponse,
  OperationsReadModel,
  WorldReadModel,
} from "@agent-world/read-model";
import type { OwnerSessionManager } from "./owner-session";

export type ApplicationRuntime = {
  auth: OwnerSessionManager;
  probeReady(): Promise<void>;
  readAgentConversations(agentId: AgentId): Promise<unknown | undefined>;
  readConversation(input: ConversationReadInput): Promise<unknown | undefined>;
  sendConversation(input: SendMessageIntent): Promise<ConversationSendResult>;
  assignTask(input: AssignTaskInput): Promise<unknown>;
  advanceMissionWorkflow(missionId: MissionId): Promise<ProductionMissionWorkflowResult>;
  createMission(input: Mission): Promise<unknown>;
  createMissionDecomposition(input: MissionDecomposition, materializedAt: string): Promise<unknown>;
  recordMissionMeeting(input: StructuredMeeting): Promise<unknown>;
  createSchedule(input: ScheduleCreateInput, createdAt: string): Promise<unknown>;
  readSchedules(limit: number): Promise<AgentSchedule[]>;
  decideApproval(input: ApprovalDecisionInput): Promise<unknown>;
  appendNativeChatControl(
    accountId: AccountId,
    event: NativeChatControlEventInput,
  ): Promise<unknown>;
  pullNativeChatResources(
    accountId: AccountId,
    request: NativeChatPullRequest,
  ): Promise<NativeChatPullResponse>;
  executeHubCommand(command: HubCommandRequest): Promise<HubCommandResponse>;
  readNativeChatBrowserProfiles(): Promise<NativeChatBrowserProfileList>;
  configureNativeChatBrowserProfile(
    input: NativeChatBrowserProfileConfigurationInput & { updatedAt: string },
  ): Promise<NativeChatBrowserProfileConfiguration>;
  writeProviderCredential(input: ProviderCredentialWriteInput): Promise<SecretWriteReceipt>;
  checkModelRoute(modelRouteId: ModelRouteId): Promise<ModelRouteCheckResponse>;
  readExecutionPreferences(
    selection: ExecutionPreferenceSelection,
  ): Promise<ExecutionPreferenceReadModel>;
  writeExecutionPreferences(layer: ExecutionPreferenceLayer, updatedAt: string): Promise<void>;
  readMemoryInbox(projectId: string, limit: number): Promise<unknown>;
  readMemoryTimeline(projectId: string, limit: number): Promise<unknown>;
  readMemoryNetwork(projectId: string, limit: number): Promise<unknown>;
  decideMemory(input: MemoryCurationDecision): Promise<unknown>;
  ingestRagDocument(input: RagIngestionRequest): Promise<unknown>;
  readHub(): Promise<HubReadModel>;
  readOperations(): Promise<OperationsReadModel>;
  readIntegrations(): Promise<IntegrationRegistry>;
  createIntegration(input: IntegrationCreate): Promise<unknown>;
  writeIntegrationCredential(input: {
    integrationId: string;
    commandId: string;
    plaintext: string;
    writtenAt: string;
  }): Promise<unknown>;
  setIntegrationEnabled(input: {
    operation: "ENABLE" | "DISABLE";
    integrationId: string;
    commandId: string;
    updatedAt: string;
  }): Promise<unknown>;
  probeIntegration(input: {
    integrationId: string;
    commandId: string;
    checkedAt: string;
  }): Promise<unknown>;
  executeIntegrationAction(input: {
    integrationId: string;
    commandId: string;
    action: IntegrationAction;
    executedAt: string;
  }): Promise<unknown>;
  createIntegrationToolAllowlist(input: IntegrationToolAllowlistCreate): Promise<unknown>;
  createIntegrationSshOperation(input: IntegrationSshOperationCreate): Promise<unknown>;
  requestIntegrationMutation(input: {
    requestId: string;
    integrationId: string;
    commandId: string;
    mutation: IntegrationMutation;
    requestedAt: string;
  }): Promise<unknown>;
  decideIntegrationMutation(input: {
    requestId: string;
    commandId: string;
    decision: "APPROVE" | "DENY";
    decidedAt: string;
  }): Promise<unknown>;
  readWorld(): Promise<WorldReadModel>;
  stop(): Promise<void>;
};

export type ScheduleCreateInput = Pick<
  AgentSchedule,
  | "id"
  | "projectId"
  | "agentId"
  | "missionId"
  | "title"
  | "taskDescription"
  | "cronExpression"
  | "timezone"
  | "isEnabled"
>;

type RuntimeState =
  | { status: "UNAVAILABLE" }
  | { status: "STARTING"; promise: Promise<boolean> }
  | { status: "READY"; runtime: ApplicationRuntime };

const registryKey = Symbol.for("agent-world.application-runtime.v1");
const registry = globalThis as typeof globalThis & { [registryKey]?: RuntimeState };

export function getApplicationRuntime(): ApplicationRuntime | undefined {
  const state = registry[registryKey];
  return state?.status === "READY" ? state.runtime : undefined;
}

export async function startApplicationRuntime(
  create: () => Promise<ApplicationRuntime>,
): Promise<boolean> {
  const current = registry[registryKey];
  if (current?.status === "READY") {
    return true;
  }
  if (current?.status === "STARTING") {
    return current.promise;
  }

  const promise = (async () => {
    try {
      const runtime = await create();
      registry[registryKey] = { status: "READY", runtime };
      return true;
    } catch {
      registry[registryKey] = { status: "UNAVAILABLE" };
      return false;
    }
  })();
  registry[registryKey] = { status: "STARTING", promise };
  return promise;
}

export async function stopApplicationRuntime(): Promise<void> {
  const state = registry[registryKey];
  registry[registryKey] = { status: "UNAVAILABLE" };
  if (state?.status === "STARTING") {
    await state.promise;
    return stopApplicationRuntime();
  }
  if (state?.status === "READY") {
    await state.runtime.stop();
  }
}

export function resetApplicationRuntimeForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Application runtime reset is test-only");
  }
  registry[registryKey] = { status: "UNAVAILABLE" };
}
