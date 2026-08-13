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
});
