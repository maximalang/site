import { describe, expect, it, vi } from "vitest";
import { DurableModelExecutionDispatcher } from "./durable-dispatcher.js";
import { ModelTaskExecutionRequestSchema } from "./task-adapter.js";

const request = ModelTaskExecutionRequestSchema.parse({
  schemaVersion: 1,
  adapterKind: "API_MODEL",
  runId: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_44444444-4444-4444-4444-444444444444",
  sessionId: "session_55555555-5555-5555-5555-555555555555",
  routeId: "route_77777777-7777-7777-7777-777777777777",
  modelRouteId: "model_route_66666666-6666-6666-6666-666666666666",
  idempotencyKey: "api:run-1",
  prompt: "Bounded context",
  maxOutputTokens: 1_000,
});

describe("DurableModelExecutionDispatcher", () => {
  it("persists a gateway result before returning a replayable receipt", async () => {
    const complete = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      runId: request.runId,
      modelRouteId: request.modelRouteId,
      upstreamRequestId: "upstream-1",
      finishReason: "STOP",
      content: "Result",
      toolCalls: [],
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      monetaryCost: {
        amountUsd: 0.001,
        source: "LITELLM_RESPONSE_HEADER",
        estimated: true,
      },
    });
    const store = {
      prepare: vi
        .fn()
        .mockResolvedValue({ outcome: "EXECUTE", externalRunId: "model-execution-1" }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
      observe: vi.fn(),
    };
    const dispatcher = new DurableModelExecutionDispatcher({
      gateway: { complete, health: vi.fn() },
      store,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
      executionId: () => "model-execution-1",
    });
    await expect(dispatcher.dispatch(request)).resolves.toEqual({
      acceptedAt: "2026-08-15T12:00:00.000Z",
      externalRunId: "model-execution-1",
    });
    expect(store.complete).toHaveBeenCalledWith(
      "model-execution-1",
      expect.objectContaining({ content: "Result", monetaryCost: expect.any(Object) }),
      "2026-08-15T12:00:00.000Z",
    );
  });

  it("does not repeat the gateway request for an exact durable replay", async () => {
    const complete = vi.fn();
    const dispatcher = new DurableModelExecutionDispatcher({
      gateway: { complete, health: vi.fn() },
      store: {
        prepare: vi.fn().mockResolvedValue({
          outcome: "REPLAY",
          externalRunId: "model-execution-1",
          acceptedAt: "2026-08-15T12:00:00.000Z",
        }),
        complete: vi.fn(),
        fail: vi.fn(),
        observe: vi.fn(),
      },
      executionId: () => "unused",
    });
    await expect(dispatcher.dispatch(request)).resolves.toEqual({
      acceptedAt: "2026-08-15T12:00:00.000Z",
      externalRunId: "model-execution-1",
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("persists a bounded terminal failure instead of leaving a retryable unknown outcome", async () => {
    const store = {
      prepare: vi
        .fn()
        .mockResolvedValue({ outcome: "EXECUTE", externalRunId: "model-execution-1" }),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
      observe: vi.fn(),
    };
    const dispatcher = new DurableModelExecutionDispatcher({
      gateway: {
        complete: vi.fn().mockRejectedValue(new Error("secret provider body")),
        health: vi.fn(),
      },
      store,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
      executionId: () => "model-execution-1",
    });
    await expect(dispatcher.dispatch(request)).resolves.toEqual(
      expect.objectContaining({ externalRunId: "model-execution-1" }),
    );
    expect(store.fail).toHaveBeenCalledWith(
      "model-execution-1",
      "UPSTREAM_UNAVAILABLE",
      "2026-08-15T12:00:00.000Z",
    );
  });
});
