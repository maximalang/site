import { describe, expect, it, vi } from "vitest";
import { ModelTaskExecutionAdapter } from "./task-adapter.js";

const task = {
  runId: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_44444444-4444-4444-4444-444444444444",
  sessionId: "session_55555555-5555-5555-5555-555555555555",
  externalAgentId: "model-route-binding",
  externalSessionRef: "api-session-1",
  title: "Verify the API route",
  description: "Return a structured result.",
  idempotencyKey: "api:run-1",
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
    compiledAt: "2026-08-15T11:59:00.000Z",
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
    rendered: "## GOAL\nVerify the API route",
    evidence: [],
  },
} as const;

describe("ModelTaskExecutionAdapter", () => {
  it("maps a canonical API binding and lazy Context Pack to one durable execution request", async () => {
    const resolve = vi.fn().mockResolvedValue({
      routeId: task.contextPack.routeId,
      modelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
      mode: "API",
    });
    const dispatch = vi.fn().mockResolvedValue({
      acceptedAt: "2026-08-15T12:00:00.000Z",
      externalRunId: "model-execution-1",
    });
    const adapter = new ModelTaskExecutionAdapter({
      kind: "API_MODEL",
      resolver: { resolve },
      dispatcher: { dispatch, observe: vi.fn() },
    });
    await expect(adapter.executeTask(task)).resolves.toEqual({
      acceptedAt: "2026-08-15T12:00:00.000Z",
      externalRunId: "model-execution-1",
    });
    expect(resolve).toHaveBeenCalledWith({
      bindingId: task.bindingId,
      agentId: task.agentId,
      adapterKind: "API_MODEL",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: task.runId,
        modelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
        routeId: task.contextPack.routeId,
        prompt: task.contextPack.rendered,
        maxOutputTokens: 1_000,
        idempotencyKey: task.idempotencyKey,
      }),
    );
  });

  it("rejects a resolver mode mismatch before dispatch", async () => {
    const dispatch = vi.fn();
    const adapter = new ModelTaskExecutionAdapter({
      kind: "LOCAL_MODEL",
      resolver: {
        resolve: vi.fn().mockResolvedValue({
          routeId: task.contextPack.routeId,
          modelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
          mode: "API",
        }),
      },
      dispatcher: { dispatch, observe: vi.fn() },
    });
    await expect(adapter.executeTask(task)).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("delegates restart-safe terminal observation", async () => {
    const observe = vi.fn().mockResolvedValue({
      status: "COMPLETED",
      observedAt: "2026-08-15T12:01:00.000Z",
    });
    const adapter = new ModelTaskExecutionAdapter({
      kind: "API_MODEL",
      resolver: { resolve: vi.fn() },
      dispatcher: { dispatch: vi.fn(), observe },
    });
    await expect(adapter.waitForTask("model-execution-1", 1_000)).resolves.toEqual({
      status: "COMPLETED",
      observedAt: "2026-08-15T12:01:00.000Z",
    });
  });
});
