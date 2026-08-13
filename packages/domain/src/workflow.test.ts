import { describe, expect, it } from "vitest";
import { ApprovalStateSchema, RunSchema, TaskIntentSchema } from "./index.js";

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

  it("keeps canonical Run identity separate from Agent, Session and upstream run IDs", () => {
    const run = RunSchema.parse({
      schemaVersion: 1,
      id: `run_${UUID}`,
      taskId: `task_${UUID}`,
      agentId: `agent_${UUID}`,
      approvalId: `approval_${UUID}`,
      adapterKind: "OPENCLAW",
      bindingId: `binding_${UUID}`,
      sessionId: `session_${UUID}`,
      status: "RUNNING",
      attempt: 1,
      dispatchIdempotencyKey: `run:${UUID}`,
      externalRunId: "openclaw-run-42",
      createdAt: "2026-08-13T05:31:00.000Z",
      startedAt: "2026-08-13T05:31:01.000Z",
    });
    expect(run.id).toBe(`run_${UUID}`);
    expect(run.externalRunId).toBe("openclaw-run-42");
  });

  it("rejects false execution and terminal claims", () => {
    const base = {
      schemaVersion: 1,
      id: `run_${UUID}`,
      taskId: `task_${UUID}`,
      agentId: `agent_${UUID}`,
      approvalId: `approval_${UUID}`,
      adapterKind: "OPENCLAW",
      bindingId: `binding_${UUID}`,
      sessionId: `session_${UUID}`,
      attempt: 0,
      dispatchIdempotencyKey: `run:${UUID}`,
      createdAt: "2026-08-13T05:31:00.000Z",
    };
    expect(
      RunSchema.safeParse({ ...base, status: "RUNNING", externalRunId: "upstream" }).success,
    ).toBe(false);
    expect(RunSchema.safeParse({ ...base, status: "FAILED" }).success).toBe(false);
    expect(
      RunSchema.safeParse({
        ...base,
        status: "DISPATCH_PENDING",
        externalRunId: "not-yet-accepted",
      }).success,
    ).toBe(false);
  });
});
