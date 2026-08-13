import { describe, expect, it } from "vitest";
import { ApprovalStateSchema, TaskIntentSchema } from "./index.js";

const UUID = "019ff96a-07fa-76a3-a020-9a32cf2d1a51";

describe("task and approval contracts", () => {
  it("parses a policy-aware TaskIntent for a canonical Agent", () => {
    const intent = TaskIntentSchema.parse({
      schemaVersion: 1,
      id: `task_${UUID}`,
      projectId: `project_${UUID}`,
      assigneeAgentId: `agent_${UUID}`,
      title: "Verify the upstream release",
      description: "Compare the release artifact to the pinned source evidence.",
      approvalRequirement: "REQUIRED",
      idempotencyKey: `task:${UUID}`,
      createdAt: "2026-08-13T05:30:00.000Z",
    });

    expect(intent.assigneeAgentId).toBe(`agent_${UUID}`);
    expect(intent.approvalRequirement).toBe("REQUIRED");
  });

  it("rejects Account identity and credential-shaped domain drift", () => {
    const result = TaskIntentSchema.safeParse({
      schemaVersion: 1,
      id: `task_${UUID}`,
      projectId: `project_${UUID}`,
      assigneeAgentId: `account_${UUID}`,
      title: "Unsafe task",
      approvalRequirement: "NOT_REQUIRED",
      idempotencyKey: `task:${UUID}`,
      createdAt: "2026-08-13T05:30:00.000Z",
      apiKey: "must-not-enter-domain-contracts",
    });

    expect(result.success).toBe(false);
  });

  it("represents pending and terminal approval states explicitly", () => {
    const pending = ApprovalStateSchema.parse({
      type: "PENDING",
      approvalId: `approval_${UUID}`,
      requestedAt: "2026-08-13T05:30:00.000Z",
      expiresAt: "2026-08-13T05:45:00.000Z",
    });
    const denied = ApprovalStateSchema.parse({
      type: "DENIED",
      approvalId: `approval_${UUID}`,
      decidedAt: "2026-08-13T05:31:00.000Z",
      reason: "Tool is outside the Agent permission scope.",
    });

    expect(pending.type).toBe("PENDING");
    expect(denied.type).toBe("DENIED");
  });

  it("rejects a pending approval whose expiry is not after its request", () => {
    const result = ApprovalStateSchema.safeParse({
      type: "PENDING",
      approvalId: `approval_${UUID}`,
      requestedAt: "2026-08-13T05:30:00.000Z",
      expiresAt: "2026-08-13T05:29:59.000Z",
    });

    expect(result.success).toBe(false);
  });
});
