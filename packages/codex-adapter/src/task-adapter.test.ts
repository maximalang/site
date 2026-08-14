import { describe, expect, it, vi } from "vitest";
import { CodexTaskExecutionAdapter } from "./task-adapter.js";

const task = {
  runId: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_44444444-4444-4444-4444-444444444444",
  sessionId: "session_55555555-5555-5555-5555-555555555555",
  externalAgentId: "codex-profile-1",
  externalSessionRef: "thread-opaque-1",
  title: "Verify the contracts",
  description: "Run the narrow validation suite.",
  idempotencyKey: "codex:run-1",
  contextPack: {
    schemaVersion: 1,
    compilerVersion: "1.0.0",
    id: "context_pack_88888888-8888-8888-8888-888888888888",
    runId: "run_11111111-1111-1111-1111-111111111111",
    taskId: "task_22222222-2222-2222-2222-222222222222",
    agentId: "agent_33333333-3333-3333-3333-333333333333",
    projectId: "project_99999999-9999-9999-9999-999999999999",
    routeId: "route_77777777-7777-7777-7777-777777777777",
    tokenBudget: 1_000,
    estimatedTokens: 20,
    contentHash: "a".repeat(64),
    compiledAt: "2026-08-13T11:59:00.000Z",
    sections: [
      "GOAL",
      "CURRENT_PROJECT_STATE",
      "RELEVANT_DECISIONS",
      "RELEVANT_MEMORY",
      "RELEVANT_FINDINGS",
      "REQUIRED_SKILLS",
      "AVAILABLE_TOOLS",
      "ARTIFACT_REFERENCES",
      "EXPECTED_OUTPUT",
      "HANDOFF_CONTRACT",
    ].map((name) => ({ name, content: "" })),
    rendered: "## GOAL\nVerify the contracts\n\n## RELEVANT_MEMORY\nCanonical evidence.",
    evidence: [],
  },
} as const;

const binding = {
  routeId: "route_77777777-7777-7777-7777-777777777777",
  accountId: "account_66666666-6666-6666-6666-666666666666",
  policy: {
    workingDirectory: "C:/workspace/project",
    sandbox: "WORKSPACE_WRITE",
    approvalPolicy: "ON_REQUEST",
    networkAccess: false,
    timeoutMs: 60_000,
  },
} as const;

describe("CodexTaskExecutionAdapter", () => {
  it("resolves canonical binding policy and dispatches one typed Codex request", async () => {
    const resolve = vi.fn(async () => binding);
    const dispatch = vi.fn(async () => ({
      acceptedAt: "2026-08-13T12:00:00.000Z",
      externalRunId: "codex-execution-1",
    }));
    const adapter = new CodexTaskExecutionAdapter({
      resolver: { resolve },
      dispatcher: {
        dispatch,
        observe: vi.fn(),
      },
    });

    expect(adapter.kind).toBe("CODEX");
    await expect(adapter.executeTask(task)).resolves.toEqual({
      acceptedAt: "2026-08-13T12:00:00.000Z",
      externalRunId: "codex-execution-1",
    });
    expect(resolve).toHaveBeenCalledWith({
      runId: task.runId,
      bindingId: task.bindingId,
      agentId: task.agentId,
      externalAgentId: task.externalAgentId,
    });
    expect(dispatch).toHaveBeenCalledWith({
      schemaVersion: 1,
      runId: task.runId,
      taskId: task.taskId,
      agentId: task.agentId,
      bindingId: task.bindingId,
      routeId: binding.routeId,
      accountId: binding.accountId,
      sessionId: task.sessionId,
      codexThreadId: task.externalSessionRef,
      idempotencyKey: task.idempotencyKey,
      prompt: task.contextPack.rendered,
      policy: binding.policy,
    });
  });

  it("delegates bounded observations without exposing dispatcher internals", async () => {
    const observe = vi.fn(async () => ({
      status: "COMPLETED" as const,
      observedAt: "2026-08-13T12:01:00.000Z",
    }));
    const adapter = new CodexTaskExecutionAdapter({
      resolver: { resolve: async () => binding },
      dispatcher: { dispatch: vi.fn(), observe },
    });

    await expect(adapter.waitForTask("codex-execution-1", 5_000)).resolves.toEqual({
      status: "COMPLETED",
      observedAt: "2026-08-13T12:01:00.000Z",
    });
    expect(observe).toHaveBeenCalledWith("codex-execution-1", 5_000);
  });

  it("fails closed before dispatch on malformed resolved policy", async () => {
    const dispatch = vi.fn();
    const adapter = new CodexTaskExecutionAdapter({
      resolver: {
        resolve: async () => ({ ...binding, accountId: task.agentId }),
      },
      dispatcher: { dispatch, observe: vi.fn() },
    });

    await expect(adapter.executeTask(task)).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
