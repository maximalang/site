import { describe, expect, it } from "vitest";
import { ApprovalDecisionRequestSchema, ApprovalDecisionResponseSchema } from "./index.js";

describe("approval decision HTTP contracts", () => {
  it("requires a reason only for deny and revoke", () => {
    const base = {
      schemaVersion: 1,
      taskId: "task_11111111-1111-1111-1111-111111111111",
      decisionId: "22222222-2222-4222-8222-222222222222",
    };
    expect(ApprovalDecisionRequestSchema.safeParse({ ...base, decision: "APPROVE" }).success).toBe(
      true,
    );
    expect(ApprovalDecisionRequestSchema.safeParse({ ...base, decision: "DENY" }).success).toBe(
      false,
    );
    expect(
      ApprovalDecisionRequestSchema.safeParse({
        ...base,
        decision: "REVOKE",
        reason: "Owner withdrew authorization.",
      }).success,
    ).toBe(true);
  });

  it("does not permit a response to claim dispatch without a canonical Run", () => {
    expect(
      ApprovalDecisionResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "DECIDED",
        approval: {
          type: "APPROVED",
          approvalId: "approval_11111111-1111-1111-1111-111111111111",
          decidedAt: "2026-08-13T10:00:00.000Z",
        },
        dispatch: "DISPATCHED",
      }).success,
    ).toBe(false);
  });

  it("accepts bounded canonical execution provenance without secret locators", () => {
    const parsed = ApprovalDecisionResponseSchema.parse({
      schemaVersion: 1,
      outcome: "DECIDED",
      approval: {
        type: "APPROVED",
        approvalId: "approval_11111111-1111-1111-1111-111111111111",
        decidedAt: "2026-08-13T10:00:00.000Z",
      },
      run: {
        schemaVersion: 1,
        id: "run_11111111-1111-1111-1111-111111111111",
        taskId: "task_11111111-1111-1111-1111-111111111111",
        agentId: "agent_11111111-1111-1111-1111-111111111111",
        approvalId: "approval_11111111-1111-1111-1111-111111111111",
        adapterKind: "CODEX",
        bindingId: "binding_11111111-1111-1111-1111-111111111111",
        sessionId: "session_11111111-1111-1111-1111-111111111111",
        status: "RUNNING",
        attempt: 1,
        dispatchIdempotencyKey: "run:1",
        externalRunId: "codex_execution_external",
        createdAt: "2026-08-13T10:00:00.000Z",
        startedAt: "2026-08-13T10:00:01.000Z",
      },
      execution: {
        routeId: "route_11111111-1111-1111-1111-111111111111",
        accountId: "account_11111111-1111-1111-1111-111111111111",
        mode: "CODEX",
        adapterKind: "CODEX",
        modelRouteId: "model_route_11111111-1111-1111-1111-111111111111",
        remoteModelId: "gpt-5.6-codex",
      },
      dispatch: "DISPATCHED",
    });
    expect(JSON.stringify(parsed)).not.toMatch(/thread|credential|workingDirectory/i);
  });
});
