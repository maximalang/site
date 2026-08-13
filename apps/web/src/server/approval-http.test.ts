import { ApprovalRunStoreError } from "@agent-world/postgres-store";
import { describe, expect, it, vi } from "vitest";
import { createApprovalRouteHandler } from "./approval-http";

const body = {
  schemaVersion: 1,
  taskId: "task_11111111-1111-1111-1111-111111111111",
  decisionId: "22222222-2222-4222-8222-222222222222",
  decision: "APPROVE",
} as const;

function request(input: unknown = body) {
  return new Request("https://world.test/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://world.test" },
    body: JSON.stringify(input),
  });
}

describe("approval decision HTTP", () => {
  it("derives the bounded command identity and decision timestamp server-side", async () => {
    const decide = vi.fn(async (input) => ({
      outcome: "DECIDED",
      approval: {
        type: "APPROVED",
        approvalId: input.approvalId,
        decidedAt: input.decidedAt,
      },
      run: {
        schemaVersion: 1,
        id: "run_11111111-1111-1111-1111-111111111111",
        taskId: input.taskId,
        agentId: "agent_33333333-3333-3333-3333-333333333333",
        approvalId: input.approvalId,
        adapterKind: "OPENCLAW",
        bindingId: "binding_44444444-4444-4444-4444-444444444444",
        sessionId: "session_55555555-5555-5555-5555-555555555555",
        status: "DISPATCH_PENDING",
        attempt: 0,
        dispatchIdempotencyKey: "run:11111111-1111-1111-1111-111111111111",
        createdAt: input.decidedAt,
      },
      dispatch: "PENDING",
    }));
    const response = await createApprovalRouteHandler({
      authorize: async () => true,
      decide,
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    })(request());
    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledWith({
      taskId: body.taskId,
      approvalId: "approval_11111111-1111-1111-1111-111111111111",
      decision: "APPROVE",
      commandId: "approval-decision:approve:22222222-2222-4222-8222-222222222222",
      decidedAt: "2026-08-13T10:00:00.000Z",
    });
    expect(await response.json()).toMatchObject({
      approval: { type: "APPROVED" },
      dispatch: "PENDING",
    });
  });

  it("fails closed for authorization, malformed decisions, conflicts and unavailable state", async () => {
    const unauthorized = await createApprovalRouteHandler({
      authorize: async () => false,
      decide: vi.fn(),
    })(request());
    expect(unauthorized.status).toBe(401);
    const malformed = await createApprovalRouteHandler({
      authorize: async () => true,
      decide: vi.fn(),
    })(request({ ...body, decision: "DENY" }));
    expect(malformed.status).toBe(400);
    const conflict = await createApprovalRouteHandler({
      authorize: async () => true,
      decide: async () => {
        throw new ApprovalRunStoreError("DECISION_CONFLICT");
      },
    })(request());
    expect(conflict.status).toBe(409);
    const unavailable = await createApprovalRouteHandler({
      authorize: async () => true,
      decide: async () => {
        throw new Error("database detail");
      },
    })(request());
    expect(unavailable.status).toBe(503);
  });
});
