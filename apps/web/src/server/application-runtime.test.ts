import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApplicationRuntime,
  resetApplicationRuntimeForTests,
  startApplicationRuntime,
  stopApplicationRuntime,
} from "./application-runtime";

function runtime() {
  return {
    auth: {} as never,
    probeReady: vi.fn(async () => undefined),
    readAgentConversations: vi.fn(),
    readConversation: vi.fn(),
    sendConversation: vi.fn(),
    assignTask: vi.fn(),
    advanceMissionWorkflow: vi.fn(),
    createMissionDecomposition: vi.fn(),
    createMission: vi.fn(),
    recordMissionMeeting: vi.fn(),
    createSchedule: vi.fn(),
    readSchedules: vi.fn(),
    decideApproval: vi.fn(),
    appendNativeChatControl: vi.fn(),
    pullNativeChatResources: vi.fn(),
    executeHubCommand: vi.fn(),
    readNativeChatBrowserProfiles: vi.fn(),
    configureNativeChatBrowserProfile: vi.fn(),
    writeProviderCredential: vi.fn(),
    checkModelRoute: vi.fn(),
    readExecutionPreferences: vi.fn(),
    writeExecutionPreferences: vi.fn(),
    readMemoryInbox: vi.fn(),
    readMemoryTimeline: vi.fn(),
    readMemoryNetwork: vi.fn(),
    decideMemory: vi.fn(),
    ingestRagDocument: vi.fn(),
    readHub: vi.fn(),
    readOperations: vi.fn(),
    readIntegrations: vi.fn(),
    createIntegration: vi.fn(),
    writeIntegrationCredential: vi.fn(),
    setIntegrationEnabled: vi.fn(),
    probeIntegration: vi.fn(),
    executeIntegrationAction: vi.fn(),
    createIntegrationToolAllowlist: vi.fn(),
    createIntegrationSshOperation: vi.fn(),
    requestIntegrationMutation: vi.fn(),
    decideIntegrationMutation: vi.fn(),
    readWorld: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
}

describe("application runtime registry", () => {
  beforeEach(() => resetApplicationRuntimeForTests());

  it("coalesces startup and publishes only a fully constructed runtime", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const value = runtime();
    const create = vi.fn(async () => {
      await gate;
      return value;
    });

    const first = startApplicationRuntime(create);
    const second = startApplicationRuntime(create);
    expect(getApplicationRuntime()).toBeUndefined();
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(create).toHaveBeenCalledOnce();
    expect(getApplicationRuntime()).toBe(value);
  });

  it("fails closed without publishing partial startup state", async () => {
    await expect(
      startApplicationRuntime(async () => {
        throw new Error("database-password-must-not-leak");
      }),
    ).resolves.toBe(false);
    expect(getApplicationRuntime()).toBeUndefined();
  });

  it("stops a published runtime exactly once", async () => {
    const value = runtime();
    await startApplicationRuntime(async () => value);
    await stopApplicationRuntime();
    await stopApplicationRuntime();
    expect(value.stop).toHaveBeenCalledOnce();
    expect(getApplicationRuntime()).toBeUndefined();
  });
});
