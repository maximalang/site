import { describe, expect, it, vi } from "vitest";
import { decideApproval } from "./approval-api";

const input = {
  taskId: "task_11111111-1111-1111-1111-111111111111",
  decisionId: "22222222-2222-4222-8222-222222222222",
  decision: "APPROVE" as const,
  csrfToken: "csrf",
};

const result = {
  schemaVersion: 1 as const,
  outcome: "DECIDED" as const,
  approval: {
    type: "APPROVED" as const,
    approvalId: "approval_11111111-1111-1111-1111-111111111111",
    decidedAt: "2026-08-13T10:00:00.000Z",
  },
  run: {
    schemaVersion: 1 as const,
    id: "run_11111111-1111-1111-1111-111111111111",
    taskId: input.taskId,
    agentId: "agent_33333333-3333-3333-3333-333333333333",
    approvalId: "approval_11111111-1111-1111-1111-111111111111",
    adapterKind: "OPENCLAW" as const,
    bindingId: "binding_44444444-4444-4444-4444-444444444444",
    sessionId: "session_55555555-5555-5555-5555-555555555555",
    status: "DISPATCH_PENDING" as const,
    attempt: 0,
    dispatchIdempotencyKey: "run:11111111-1111-1111-1111-111111111111",
    createdAt: "2026-08-13T10:00:00.000Z",
  },
  dispatch: "PENDING" as const,
};

describe("approval decision client", () => {
  it("sends the minimal owner decision with in-memory CSRF", async () => {
    const fetcher = vi.fn(async () => Response.json(result));
    await expect(decideApproval(input, fetcher)).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith("/api/approvals", {
      body: JSON.stringify({
        schemaVersion: 1,
        taskId: input.taskId,
        decisionId: input.decisionId,
        decision: "APPROVE",
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Agent-World-CSRF": "csrf" },
      method: "POST",
    });
  });

  it("rejects a dispatched claim without a canonical Run", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ...result, run: undefined, dispatch: "DISPATCHED" }),
    );
    await expect(decideApproval(input, fetcher)).rejects.toThrow(
      "Invalid approval decision response",
    );
  });
});
