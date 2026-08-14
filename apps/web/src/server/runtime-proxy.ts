import { getApplicationRuntime } from "./application-runtime";
import type { OwnerAuthPort } from "./owner-auth-http";

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

export function authorizeApplicationRequest(request: Request): Promise<boolean> {
  try {
    return runtime().auth.authorize(request);
  } catch {
    return Promise.resolve(false);
  }
}

export function readApplicationWorld() {
  return runtime().readWorld();
}

export function readApplicationHub() {
  return runtime().readHub();
}
