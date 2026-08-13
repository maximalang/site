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

export const applicationApprovalDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  decide: (input: Parameters<ReturnType<typeof runtime>["decideApproval"]>[0]) =>
    runtime().decideApproval(input),
};

export const applicationHubCommandDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  execute: (command: Parameters<ReturnType<typeof runtime>["executeHubCommand"]>[0]) =>
    runtime().executeHubCommand(command),
};

export const applicationProviderCredentialDependencies = {
  authorize: (request: Request) => runtime().auth.authorize(request),
  write: (input: Parameters<ReturnType<typeof runtime>["writeProviderCredential"]>[0]) =>
    runtime().writeProviderCredential(input),
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
