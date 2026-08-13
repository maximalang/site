import type { ConversationSendResult } from "@agent-world/conversation-service";
import type { AgentId, ModelRouteId, SendMessageIntent } from "@agent-world/domain";
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
  ModelRouteCheckResponse,
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
  decideApproval(input: ApprovalDecisionInput): Promise<unknown>;
  executeHubCommand(command: HubCommandRequest): Promise<HubCommandResponse>;
  writeProviderCredential(input: ProviderCredentialWriteInput): Promise<SecretWriteReceipt>;
  checkModelRoute(modelRouteId: ModelRouteId): Promise<ModelRouteCheckResponse>;
  readExecutionPreferences(
    selection: ExecutionPreferenceSelection,
  ): Promise<ExecutionPreferenceReadModel>;
  writeExecutionPreferences(layer: ExecutionPreferenceLayer, updatedAt: string): Promise<void>;
  readHub(): Promise<HubReadModel>;
  readWorld(): Promise<WorldReadModel>;
  stop(): Promise<void>;
};

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
