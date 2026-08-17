import { getApplicationRuntime } from "./application-runtime";
import type { OwnerAuthPort } from "./owner-auth-http";

type WithoutCreatedAt<T> = T extends unknown ? Omit<T, "createdAt"> : never;

function runtime() {
  const value = getApplicationRuntime();
  if (!value) {
    throw new Error("Application runtime is unavailable");
  }
  return value;
}

export const applicationAuthPort: OwnerAuthPort = {
  login: (password) => runtime().auth.login(password),
  session: (request) => runtime().auth.session(request),
  logout: (request) => runtime().auth.logout(request),
};

export const applicationConversationDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  read: (input: Parameters<ReturnType<typeof runtime>["readConversation"]>[0]) =>
    runtime().readConversation(input),
  send: (input: Parameters<ReturnType<typeof runtime>["sendConversation"]>[0]) =>
    runtime().sendConversation(input),
};

export const applicationAgentConversationDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  read: (agentId: Parameters<ReturnType<typeof runtime>["readAgentConversations"]>[0]) =>
    runtime().readAgentConversations(agentId),
};

export const applicationTaskDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  assign: (input: Parameters<ReturnType<typeof runtime>["assignTask"]>[0]) =>
    runtime().assignTask(input),
};

export const applicationMissionWorkflowDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  advance: (missionId: Parameters<ReturnType<typeof runtime>["advanceMissionWorkflow"]>[0]) =>
    runtime().advanceMissionWorkflow(missionId),
};

export const applicationMissionDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  create: (input: Parameters<ReturnType<typeof runtime>["createMission"]>[0]) =>
    runtime().createMission(input),
};

export const applicationMissionCollaborationDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  createDecomposition: (
    input: Parameters<ReturnType<typeof runtime>["createMissionDecomposition"]>[0],
    materializedAt: string,
  ) => runtime().createMissionDecomposition(input, materializedAt),
  recordMeeting: (input: Parameters<ReturnType<typeof runtime>["recordMissionMeeting"]>[0]) =>
    runtime().recordMissionMeeting(input),
};

export const applicationScheduleDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  list: (limit: number) => runtime().readSchedules(limit),
  create: (input: Parameters<ReturnType<typeof runtime>["createSchedule"]>[0], createdAt: string) =>
    runtime().createSchedule(input, createdAt),
};

export const applicationApprovalDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  decide: (input: Parameters<ReturnType<typeof runtime>["decideApproval"]>[0]) =>
    runtime().decideApproval(input),
};

export function appendApplicationNativeChatControl(
  accountId: Parameters<ReturnType<typeof runtime>["appendNativeChatControl"]>[0],
  event: Parameters<ReturnType<typeof runtime>["appendNativeChatControl"]>[1],
) {
  return runtime().appendNativeChatControl(accountId, event);
}

export function pullApplicationNativeChatResources(
  accountId: Parameters<ReturnType<typeof runtime>["pullNativeChatResources"]>[0],
  request: Parameters<ReturnType<typeof runtime>["pullNativeChatResources"]>[1],
) {
  return runtime().pullNativeChatResources(accountId, request);
}

export const applicationHubCommandDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  execute: (command: Parameters<ReturnType<typeof runtime>["executeHubCommand"]>[0]) =>
    runtime().executeHubCommand(command),
};

export const applicationNativeChatProfileDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  list: () => runtime().readNativeChatBrowserProfiles(),
  configure: (
    input: Parameters<ReturnType<typeof runtime>["configureNativeChatBrowserProfile"]>[0],
  ) => runtime().configureNativeChatBrowserProfile(input),
};

export const applicationProviderCredentialDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  write: (input: Parameters<ReturnType<typeof runtime>["writeProviderCredential"]>[0]) =>
    runtime().writeProviderCredential(input),
};

export const applicationModelRouteCheckDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  check: (modelRouteId: Parameters<ReturnType<typeof runtime>["checkModelRoute"]>[0]) =>
    runtime().checkModelRoute(modelRouteId),
};

export const applicationExecutionPreferenceDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  read: (selection: Parameters<ReturnType<typeof runtime>["readExecutionPreferences"]>[0]) =>
    runtime().readExecutionPreferences(selection),
  write: (
    layer: Parameters<ReturnType<typeof runtime>["writeExecutionPreferences"]>[0],
    updatedAt: string,
  ) => runtime().writeExecutionPreferences(layer, updatedAt),
};

export const applicationMemoryDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  inbox: (projectId: string, limit: number) => runtime().readMemoryInbox(projectId, limit),
  timeline: (projectId: string, limit: number) => runtime().readMemoryTimeline(projectId, limit),
  network: (projectId: string, limit: number) => runtime().readMemoryNetwork(projectId, limit),
  decide: (input: Parameters<ReturnType<typeof runtime>["decideMemory"]>[0]) =>
    runtime().decideMemory(input),
};

export const applicationRagDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  ingest: (input: Parameters<ReturnType<typeof runtime>["ingestRagDocument"]>[0]) =>
    runtime().ingestRagDocument(input),
};

export const applicationIntegrationDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  list: () => runtime().readIntegrations(),
  create: (input: Parameters<ReturnType<typeof runtime>["createIntegration"]>[0]) =>
    runtime().createIntegration(input),
  credential: (
    input: Omit<
      Parameters<ReturnType<typeof runtime>["writeIntegrationCredential"]>[0],
      "writtenAt"
    >,
    writtenAt: string,
  ) => runtime().writeIntegrationCredential({ ...input, writtenAt }),
  lifecycle: (
    input: Omit<Parameters<ReturnType<typeof runtime>["setIntegrationEnabled"]>[0], "updatedAt">,
    updatedAt: string,
  ) => runtime().setIntegrationEnabled({ ...input, updatedAt }),
  probe: (
    input: Omit<Parameters<ReturnType<typeof runtime>["probeIntegration"]>[0], "checkedAt">,
    checkedAt: string,
  ) => runtime().probeIntegration({ ...input, checkedAt }),
  action: (
    input: Omit<
      Parameters<ReturnType<typeof runtime>["executeIntegrationAction"]>[0],
      "executedAt"
    >,
    executedAt: string,
  ) => runtime().executeIntegrationAction({ ...input, executedAt }),
  registerTool: (
    input: Omit<
      Parameters<ReturnType<typeof runtime>["createIntegrationToolAllowlist"]>[0],
      "createdAt"
    >,
    createdAt: string,
  ) => runtime().createIntegrationToolAllowlist({ ...input, createdAt }),
  registerSshOperation: (
    input: WithoutCreatedAt<
      Parameters<ReturnType<typeof runtime>["createIntegrationSshOperation"]>[0]
    >,
    createdAt: string,
  ) => runtime().createIntegrationSshOperation({ ...input, createdAt }),
  requestMutation: (
    input: Omit<
      Parameters<ReturnType<typeof runtime>["requestIntegrationMutation"]>[0],
      "requestedAt"
    >,
    requestedAt: string,
  ) => runtime().requestIntegrationMutation({ ...input, requestedAt }),
  decideMutation: (
    input: Omit<
      Parameters<ReturnType<typeof runtime>["decideIntegrationMutation"]>[0],
      "decidedAt"
    >,
    decidedAt: string,
  ) => runtime().decideIntegrationMutation({ ...input, decidedAt }),
};

export function authorizeApplicationRequest(request: Request): Promise<boolean> {
  try {
    return runtime().auth.authorize(request);
  } catch {
    return Promise.resolve(false);
  }
}

export function readApplicationOperations() {
  return runtime().readOperations();
}

export function readApplicationWorld() {
  return runtime().readWorld();
}

export function readApplicationHub() {
  return runtime().readHub();
}
