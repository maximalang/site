import { describe, expect, it } from "vitest";
import {
  applyNativeChatControlEvent,
  initialNativeChatRunControlState,
  NativeChatBrowserProfileConfigurationSchema,
  NativeChatBrowserProfileListSchema,
  NativeChatControlEventInputSchema,
  NativeChatDispatchSchema,
  NativeChatLaunchClaimSchema,
  NativeChatLaunchMessageSchema,
  NativeChatPullRequestSchema,
} from "./chat-transport.js";

const ids = {
  account: "account_11111111-1111-1111-1111-111111111111",
  agent: "agent_22222222-2222-2222-2222-222222222222",
  dispatch: "chat_dispatch_33333333-3333-3333-3333-333333333333",
  route: "route_44444444-4444-4444-4444-444444444444",
  run: "run_55555555-5555-5555-5555-555555555555",
  task: "task_66666666-6666-6666-6666-666666666666",
} as const;

describe("Native Plus Chat contracts", () => {
  it("exposes only an opaque profile alias and public App URL to owner control surfaces", () => {
    const profile = NativeChatBrowserProfileConfigurationSchema.parse({
      schemaVersion: 1,
      accountId: ids.account,
      profileRef: "plus-primary",
      launchUrl: "https://chatgpt.com/g/ai-world-agent",
      isEnabled: true,
      updatedAt: "2026-08-14T10:00:00.000Z",
    });

    expect(profile).not.toHaveProperty("profilePath");
    expect(profile).not.toHaveProperty("cookie");
    expect(
      NativeChatBrowserProfileConfigurationSchema.safeParse({
        ...profile,
        launchUrl: "https://chatgpt.com/g/ai-world-agent?token=secret",
      }).success,
    ).toBe(false);
    expect(
      NativeChatBrowserProfileListSchema.parse({ schemaVersion: 1, profiles: [profile] }).profiles,
    ).toEqual([profile]);
  });

  it("limits the browser launcher payload to a canonical run_id", () => {
    expect(NativeChatLaunchMessageSchema.parse({ runId: ids.run })).toEqual({ runId: ids.run });
    expect(() =>
      NativeChatLaunchMessageSchema.parse({ runId: ids.run, task: "must stay in AI World" }),
    ).toThrow();
  });

  it("keeps browser profile routing outside the submitted Chat message", () => {
    const claim = NativeChatLaunchClaimSchema.parse({
      schemaVersion: 1,
      dispatchId: ids.dispatch,
      message: { runId: ids.run },
      accountId: ids.account,
      profileRef: "plus-primary",
      launchUrl: "https://chatgpt.com/g/ai-world-agent",
      launcherId: "launcher_77777777-7777-7777-7777-777777777777",
      attempt: 1,
      leaseExpiresAt: "2026-08-14T10:02:00.000Z",
    });

    expect(claim.message).toEqual({ runId: ids.run });
    expect(claim.message).not.toHaveProperty("profileRef");
    expect(claim.message).not.toHaveProperty("accountId");
    expect(claim.message).not.toHaveProperty("launchUrl");
  });

  it("binds dispatch evidence to one Account without claiming a DOM result", () => {
    const dispatch = NativeChatDispatchSchema.parse({
      schemaVersion: 1,
      id: ids.dispatch,
      runId: ids.run,
      taskId: ids.task,
      agentId: ids.agent,
      accountId: ids.account,
      routeId: ids.route,
      state: "BROWSER_SUBMITTED",
      createdAt: "2026-08-14T10:00:00.000Z",
      submittedAt: "2026-08-14T10:01:00.000Z",
    });

    expect(dispatch.accountId).toBe(ids.account);
    expect(dispatch).not.toHaveProperty("output");
    expect(() =>
      NativeChatDispatchSchema.parse({ ...dispatch, attachedAt: dispatch.submittedAt }),
    ).toThrow();
  });

  it("makes context retrieval lazy, bounded and capability-specific", () => {
    const request = NativeChatPullRequestSchema.parse({
      schemaVersion: 1,
      runId: ids.run,
      resources: ["PROJECT_STATE", "MEMORY", "SKILLS"],
      query: "Only evidence needed for the current decision",
      maxItems: 12,
      maxTokens: 4_000,
    });

    expect(request.resources).toEqual(["PROJECT_STATE", "MEMORY", "SKILLS"]);
    expect(() => NativeChatPullRequestSchema.parse({ ...request, maxTokens: 1_000_001 })).toThrow();
    expect(() =>
      NativeChatPullRequestSchema.parse({ ...request, resources: ["TASK", "TASK"] }),
    ).toThrow();
  });

  it("accepts structured intermediate events and requires an explicit commit", () => {
    let state = initialNativeChatRunControlState(ids.run);
    state = applyNativeChatControlEvent(
      state,
      NativeChatControlEventInputSchema.parse({
        schemaVersion: 1,
        runId: ids.run,
        sequence: 1,
        idempotencyKey: "native-chat:begin:1",
        eventType: "BEGIN_RUN",
        payload: {},
      }),
    );
    state = applyNativeChatControlEvent(
      state,
      NativeChatControlEventInputSchema.parse({
        schemaVersion: 1,
        runId: ids.run,
        sequence: 2,
        idempotencyKey: "native-chat:finding:2",
        eventType: "FINDING",
        payload: { statement: "The event log is the replay source.", confidence: 0.95 },
      }),
    );

    expect(state.status).toBe("RUNNING");
    expect(state.lastSequence).toBe(2);

    state = applyNativeChatControlEvent(
      state,
      NativeChatControlEventInputSchema.parse({
        schemaVersion: 1,
        runId: ids.run,
        sequence: 3,
        idempotencyKey: "native-chat:commit:3",
        eventType: "COMMIT_RESULT",
        payload: {
          result: {
            schemaVersion: 1,
            fullOutput: "Done.",
            summary: "Completed with backend-owned state.",
            findings: [],
            decisions: [],
            actions: [],
            artifacts: [],
            openQuestions: [],
            nextActions: [],
            memoryCandidates: [],
            confidence: 1,
          },
        },
      }),
    );

    expect(state.status).toBe("COMPLETED");
    expect(() =>
      applyNativeChatControlEvent(
        state,
        NativeChatControlEventInputSchema.parse({
          schemaVersion: 1,
          runId: ids.run,
          sequence: 4,
          idempotencyKey: "native-chat:late:4",
          eventType: "HEARTBEAT",
          payload: { progress: "late" },
        }),
      ),
    ).toThrow(/terminal/i);
  });

  it("rejects skipped event sequences and a commit before begin_run", () => {
    const state = initialNativeChatRunControlState(ids.run);
    const commit = NativeChatControlEventInputSchema.parse({
      schemaVersion: 1,
      runId: ids.run,
      sequence: 1,
      idempotencyKey: "native-chat:commit:1",
      eventType: "COMMIT_RESULT",
      payload: {
        result: {
          schemaVersion: 1,
          fullOutput: "No begin event.",
          summary: "Invalid ordering.",
          findings: [],
          decisions: [],
          actions: [],
          artifacts: [],
          openQuestions: [],
          nextActions: [],
          memoryCandidates: [],
          confidence: 0,
        },
      },
    });
    expect(() => applyNativeChatControlEvent(state, commit)).toThrow(/begin_run/i);

    const skipped = NativeChatControlEventInputSchema.parse({
      schemaVersion: 1,
      runId: ids.run,
      sequence: 2,
      idempotencyKey: "native-chat:begin:2",
      eventType: "BEGIN_RUN",
      payload: {},
    });
    expect(() => applyNativeChatControlEvent(state, skipped)).toThrow(/sequence/i);
  });

  it("allows a terminal system failure when begin_run never arrives", () => {
    expect(
      applyNativeChatControlEvent(
        initialNativeChatRunControlState(ids.run),
        NativeChatControlEventInputSchema.parse({
          schemaVersion: 1,
          runId: ids.run,
          sequence: 1,
          idempotencyKey: "native-chat:begin-timeout:1",
          eventType: "FAIL",
          payload: {
            failureCode: "NATIVE_CHAT_BEGIN_TIMEOUT",
            message: "Native Chat did not attach before its canonical deadline.",
            retryable: true,
          },
        }),
      ),
    ).toEqual({ runId: ids.run, status: "FAILED", lastSequence: 1 });
  });
});
