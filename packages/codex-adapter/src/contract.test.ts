import { describe, expect, it } from "vitest";
import {
  CodexExecutionError,
  CodexExecutionEventSchema,
  CodexExecutionRequestSchema,
} from "./contract.js";

const request = {
  schemaVersion: 1,
  runId: "run_11111111-1111-1111-1111-111111111111",
  taskId: "task_22222222-2222-2222-2222-222222222222",
  agentId: "agent_33333333-3333-3333-3333-333333333333",
  bindingId: "binding_77777777-7777-7777-7777-777777777777",
  routeId: "route_88888888-8888-8888-8888-888888888888",
  accountId: "account_44444444-4444-4444-4444-444444444444",
  sessionId: "session_55555555-5555-5555-5555-555555555555",
  codexThreadId: "thread-opaque-1",
  idempotencyKey: "codex:run-1",
  prompt: "Inspect the repository and report the failing contract.",
  policy: {
    workingDirectory: "C:/workspace/project",
    sandbox: "WORKSPACE_WRITE",
    approvalPolicy: "ON_REQUEST",
    networkAccess: false,
    timeoutMs: 60_000,
  },
} as const;

describe("Codex execution contract", () => {
  it("keeps Agent, Account, Session and Codex thread identities distinct", () => {
    expect(CodexExecutionRequestSchema.parse(request)).toEqual(request);
    expect(
      CodexExecutionRequestSchema.safeParse({ ...request, accountId: request.agentId }).success,
    ).toBe(false);
    expect(
      CodexExecutionRequestSchema.safeParse({ ...request, codexThreadId: request.sessionId })
        .success,
    ).toBe(false);
  });

  it("fails closed on unknown policy fields, unsafe bounds and control characters", () => {
    for (const candidate of [
      { ...request, policy: { ...request.policy, elevated: true } },
      { ...request, policy: { ...request.policy, timeoutMs: 0 } },
      { ...request, prompt: `unsafe\u0000prompt` },
      { ...request, codexThreadId: "" },
    ]) {
      expect(CodexExecutionRequestSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("normalizes bounded progress, output, usage and terminal events", () => {
    const events = [
      {
        schemaVersion: 1,
        sequence: 1,
        eventType: "RUN_STARTED",
        occurredAt: "2026-08-13T12:00:00.000Z",
        threadId: "thread-opaque-1",
      },
      {
        schemaVersion: 1,
        sequence: 2,
        eventType: "FINAL_OUTPUT",
        occurredAt: "2026-08-13T12:00:01.000Z",
        content: "Contract verified.",
      },
      {
        schemaVersion: 1,
        sequence: 3,
        eventType: "USAGE_RECORDED",
        occurredAt: "2026-08-13T12:00:02.000Z",
        usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 5 },
      },
      {
        schemaVersion: 1,
        sequence: 4,
        eventType: "RUN_COMPLETED",
        occurredAt: "2026-08-13T12:00:03.000Z",
      },
    ];
    expect(events.map((event) => CodexExecutionEventSchema.parse(event))).toEqual(events);
    expect(
      CodexExecutionEventSchema.safeParse({
        ...events[1],
        content: "x".repeat(200_001),
      }).success,
    ).toBe(false);
  });

  it("exposes only bounded failure codes", () => {
    const error = new CodexExecutionError("AUTH_UNAVAILABLE");
    expect(error.message).toBe("AUTH_UNAVAILABLE");
    expect(JSON.stringify(error)).not.toContain("token");
  });
});
