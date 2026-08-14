import type { ConversationDeliveryInput } from "@agent-world/conversation-service";
import {
  AgentIdSchema,
  BindingIdSchema,
  ContextPackSchema,
  ConversationIdSchema,
  MessageIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TaskIdSchema,
} from "@agent-world/domain";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";
import { describe, expect, it, vi } from "vitest";
import {
  type OpenClawTaskExecutionInput,
  OpenClawWriteAdapter,
  type OpenClawWriteGateway,
  type OpenClawWriteGatewayCallbacks,
} from "./write-adapter.js";

function input(): ConversationDeliveryInput {
  return {
    messageId: MessageIdSchema.parse("message_11111111-1111-1111-1111-111111111111"),
    conversationId: ConversationIdSchema.parse("conversation_22222222-2222-2222-2222-222222222222"),
    agentId: AgentIdSchema.parse("agent_33333333-3333-3333-3333-333333333333"),
    bindingId: BindingIdSchema.parse("binding_44444444-4444-4444-4444-444444444444"),
    externalAgentId: "researcher",
    externalSessionRef: "agent:researcher:protocol-review",
    content: "Verify the protocol.",
    idempotencyKey: "message:11111111-1111-1111-1111-111111111111",
  };
}

function taskInput(): OpenClawTaskExecutionInput {
  const runId = RunIdSchema.parse("run_11111111-1111-1111-1111-111111111111");
  const taskId = TaskIdSchema.parse("task_22222222-2222-2222-2222-222222222222");
  const agentId = AgentIdSchema.parse("agent_33333333-3333-3333-3333-333333333333");
  return {
    runId,
    taskId,
    agentId,
    bindingId: BindingIdSchema.parse("binding_44444444-4444-4444-4444-444444444444"),
    sessionId: SessionIdSchema.parse("session_55555555-5555-5555-5555-555555555555"),
    externalAgentId: "researcher",
    externalSessionRef: "agent:researcher:task",
    title: "Verify the protocol",
    description: "Use primary evidence.",
    idempotencyKey: "run:11111111-1111-1111-1111-111111111111",
    contextPack: ContextPackSchema.parse({
      schemaVersion: 1,
      compilerVersion: "1.0.0",
      id: "context_pack_66666666-6666-6666-6666-666666666666",
      runId,
      taskId,
      agentId,
      projectId: "project_77777777-7777-7777-7777-777777777777",
      routeId: "route_88888888-8888-8888-8888-888888888888",
      tokenBudget: 1_000,
      estimatedTokens: 20,
      contentHash: "a".repeat(64),
      compiledAt: "2026-08-13T10:00:00.000Z",
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
      rendered: "## GOAL\nVerify the protocol\n\n## RELEVANT_MEMORY\nPrimary evidence.",
      evidence: [],
    }),
  };
}

function setup() {
  let callbacks: OpenClawWriteGatewayCallbacks | undefined;
  const gateway: OpenClawWriteGateway = {
    start: vi.fn(),
    stopAndWait: vi.fn(async () => undefined),
    sendChat: vi.fn(async () => ({ runId: "run-1", status: "started" })),
    runAgent: vi.fn(async () => ({ runId: "openclaw-task-run-1" })),
    waitAgent: vi.fn(async () => ({ status: "ok", startedAt: 1, endedAt: 2 })),
  };
  const telemetry = { record: vi.fn() };
  const adapter = new OpenClawWriteAdapter({
    config: {
      endpoint: "ws://127.0.0.1:18789",
      clientVersion: "0.0.0-test",
      instanceId: "writer-1",
    },
    credentialProvider: async () => ({ kind: "TOKEN", value: "gateway-secret" }),
    gatewayFactory: (factoryInput) => {
      callbacks = factoryInput.callbacks;
      return gateway;
    },
    telemetry,
    now: () => new Date("2026-08-13T10:00:01.000Z"),
    correlationId: "command-message-1",
  });
  return { adapter, callbacks: () => callbacks, gateway, telemetry };
}

const validHello = {
  protocol: PROTOCOL_VERSION,
  auth: { role: "operator", scopes: ["operator.write"] },
};

describe("OpenClawWriteAdapter", () => {
  it("does not deliver before an exact-authority hello", async () => {
    const { adapter, gateway } = setup();

    await expect(adapter.deliver(input())).rejects.toThrow("not ready");
    expect(gateway.sendChat).not.toHaveBeenCalled();
  });

  it("uses only the documented chat.send projection after hello", async () => {
    const { adapter, callbacks, gateway } = setup();
    await adapter.start();
    await callbacks()?.onHello(validHello);

    await expect(adapter.deliver(input())).resolves.toEqual({
      acceptedAt: "2026-08-13T10:00:01.000Z",
      externalRequestId: "run-1",
    });
    expect(gateway.sendChat).toHaveBeenCalledWith({
      sessionKey: "agent:researcher:protocol-review",
      agentId: "researcher",
      message: "Verify the protocol.",
      idempotencyKey: "message:11111111-1111-1111-1111-111111111111",
      suppressCommandInterpretation: true,
    });
  });

  it("dispatches an approved Task through the distinct official agent RPC", async () => {
    const { adapter, callbacks, gateway } = setup();
    await adapter.start();
    await callbacks()?.onHello(validHello);

    await expect(adapter.executeTask(taskInput())).resolves.toEqual({
      acceptedAt: "2026-08-13T10:00:01.000Z",
      externalRunId: "openclaw-task-run-1",
    });
    expect(gateway.runAgent).toHaveBeenCalledWith({
      message: taskInput().contextPack.rendered,
      agentId: "researcher",
      sessionKey: "agent:researcher:task",
      idempotencyKey: "run:11111111-1111-1111-1111-111111111111",
      label: "Verify the protocol",
      deliver: false,
      inputProvenance: {
        kind: "internal_system",
        sourceTool: "agent-world.task-dispatch",
      },
    });
    expect(gateway.sendChat).not.toHaveBeenCalled();
  });

  it("observes terminal Task state through the official agent.wait RPC", async () => {
    const { adapter, callbacks, gateway } = setup();
    await adapter.start();
    await callbacks()?.onHello(validHello);

    await expect(adapter.waitForTask("openclaw-task-run-1", 1_000)).resolves.toEqual({
      status: "COMPLETED",
      observedAt: "2026-08-13T10:00:01.000Z",
    });
    expect(gateway.waitAgent).toHaveBeenCalledWith({
      runId: "openclaw-task-run-1",
      timeoutMs: 1_000,
    });
    vi.mocked(gateway.waitAgent).mockResolvedValueOnce({ status: "error", error: "private" });
    await expect(adapter.waitForTask("openclaw-task-run-1", 1_000)).resolves.toEqual({
      status: "FAILED",
      failureCode: "UPSTREAM_RUN_ERROR",
      observedAt: "2026-08-13T10:00:01.000Z",
    });
    vi.mocked(gateway.waitAgent).mockResolvedValueOnce({ status: "timeout" });
    await expect(adapter.waitForTask("openclaw-task-run-1", 1_000)).resolves.toEqual({
      status: "RUNNING",
      observedAt: "2026-08-13T10:00:01.000Z",
    });
  });

  it.each([
    { ...validHello, auth: { role: "operator", scopes: ["operator.read"] } },
    { ...validHello, auth: { role: "operator", scopes: ["operator.write", "operator.read"] } },
    { ...validHello, protocol: PROTOCOL_VERSION + 1 },
  ])("rejects missing, additional or incompatible authority", async (hello) => {
    const { adapter, callbacks, gateway } = setup();
    await adapter.start();
    await callbacks()?.onHello(hello);

    expect(adapter.state).toBe("DEGRADED");
    expect(gateway.stopAndWait).toHaveBeenCalledOnce();
    await expect(adapter.deliver(input())).rejects.toThrow("not ready");
  });

  it("degrades on close and emits no raw transport data", async () => {
    const { adapter, callbacks, telemetry } = setup();
    await adapter.start();
    await callbacks()?.onHello(validHello);
    await callbacks()?.onClose({ phase: "post-hello", code: 1006 });

    expect(adapter.state).toBe("DEGRADED");
    await expect(adapter.deliver(input())).rejects.toThrow("not ready");
    expect(JSON.stringify(telemetry.record.mock.calls)).not.toContain("protocol-review");
    expect(JSON.stringify(telemetry.record.mock.calls)).not.toContain("gateway-secret");
  });

  it("ignores a stale hello that arrives after stop", async () => {
    const { adapter, callbacks, gateway } = setup();
    await adapter.start();
    await adapter.stop();
    await callbacks()?.onHello(validHello);

    expect(adapter.state).toBe("STOPPED");
    expect(gateway.stopAndWait).toHaveBeenCalledOnce();
    await expect(adapter.deliver(input())).rejects.toThrow("not ready");
  });

  it("does not create a socket when stopped during credential loading", async () => {
    let resolveCredential: ((credential: { kind: "TOKEN"; value: string }) => void) | undefined;
    const gatewayFactory = vi.fn();
    const adapter = new OpenClawWriteAdapter({
      config: {
        endpoint: "ws://127.0.0.1:18789",
        clientVersion: "0.0.0-test",
        instanceId: "writer-1",
      },
      credentialProvider: () =>
        new Promise((resolve) => {
          resolveCredential = resolve;
        }),
      gatewayFactory,
      telemetry: { record: vi.fn() },
      correlationId: "command-message-1",
    });

    const starting = adapter.start();
    await adapter.stop();
    resolveCredential?.({ kind: "TOKEN", value: "gateway-secret" });
    await starting;

    expect(adapter.state).toBe("STOPPED");
    expect(gatewayFactory).not.toHaveBeenCalled();
  });

  it("stays stopped when credential loading fails after cancellation", async () => {
    let rejectCredential: ((error: Error) => void) | undefined;
    const adapter = new OpenClawWriteAdapter({
      config: {
        endpoint: "ws://127.0.0.1:18789",
        clientVersion: "0.0.0-test",
        instanceId: "writer-1",
      },
      credentialProvider: () =>
        new Promise((_resolve, reject) => {
          rejectCredential = reject;
        }),
      gatewayFactory: vi.fn(),
      telemetry: { record: vi.fn() },
      correlationId: "command-message-1",
    });

    const starting = adapter.start();
    await adapter.stop();
    rejectCredential?.(new Error("secret credential error"));
    await starting;

    expect(adapter.state).toBe("STOPPED");
  });

  it("ignores callbacks after rejecting handshake authority", async () => {
    const { adapter, callbacks, gateway } = setup();
    await adapter.start();
    await callbacks()?.onHello({
      ...validHello,
      auth: { role: "operator", scopes: ["operator.read"] },
    });
    await callbacks()?.onHello(validHello);

    expect(adapter.state).toBe("DEGRADED");
    expect(gateway.stopAndWait).toHaveBeenCalledOnce();
  });

  it("rejects malformed provider receipts and provider failures with bounded telemetry", async () => {
    const { adapter, callbacks, gateway, telemetry } = setup();
    await adapter.start();
    await callbacks()?.onHello(validHello);
    vi.mocked(gateway.sendChat).mockResolvedValueOnce(null);

    await expect(adapter.deliver(input())).rejects.toThrow("invalid or stale chat send response");
    vi.mocked(gateway.sendChat).mockRejectedValueOnce(new Error("secret upstream details"));
    await expect(adapter.deliver(input())).rejects.toThrow("rejected the chat send request");

    const recorded = JSON.stringify(telemetry.record.mock.calls);
    expect(recorded).toContain("INVALID_RESPONSE");
    expect(recorded).toContain("REJECTED");
    expect(recorded).not.toContain("secret upstream details");
  });

  it("rejects invalid and stale Task dispatch receipts without provider detail", async () => {
    const { adapter, callbacks, gateway, telemetry } = setup();
    await adapter.start();
    await callbacks()?.onHello(validHello);
    const task = taskInput();
    vi.mocked(gateway.runAgent).mockResolvedValueOnce({});
    await expect(adapter.executeTask(task)).rejects.toThrow("invalid or stale");
    vi.mocked(gateway.runAgent).mockRejectedValueOnce(new Error("secret upstream detail"));
    await expect(adapter.executeTask(task)).rejects.toThrow("rejected the Task execution");
    const recorded = JSON.stringify(telemetry.record.mock.calls);
    expect(recorded).toContain("openclaw_task_dispatch_completed");
    expect(recorded).not.toContain("secret upstream detail");
  });

  it("rejects a receipt that completes after the connection closes", async () => {
    const { adapter, callbacks, gateway } = setup();
    let resolveSend: ((value: unknown) => void) | undefined;
    vi.mocked(gateway.sendChat).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    await adapter.start();
    await callbacks()?.onHello(validHello);

    const delivery = adapter.deliver(input());
    await callbacks()?.onClose({ phase: "post-hello", code: 1006 });
    resolveSend?.({ runId: "stale-run" });

    await expect(delivery).rejects.toThrow("invalid or stale chat send response");
  });
});
