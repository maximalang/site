import { createHash } from "node:crypto";
import {
  AccountIdSchema,
  ChatDispatchIdSchema,
  LauncherIdSchema,
  RunIdSchema,
} from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createNativeChatLauncherRouteHandler,
  parseNativeChatLauncherControlConfiguration,
} from "./native-chat-launcher-http";

const launcherId = LauncherIdSchema.parse("launcher_11111111-1111-4111-8111-111111111111");
const dispatchId = ChatDispatchIdSchema.parse("chat_dispatch_22222222-2222-4222-8222-222222222222");
const accountId = AccountIdSchema.parse("account_33333333-3333-4333-8333-333333333333");
const runId = RunIdSchema.parse("run_44444444-4444-4444-8444-444444444444");
const token = "a".repeat(43);
const tokenSha256 = createHash("sha256").update(token).digest("hex");

function request(body: unknown, bearer = token) {
  return new Request("https://agent-world.example.com/api/native-chat-launcher", {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function dependencies() {
  return {
    claim: vi.fn(async () => ({
      schemaVersion: 1 as const,
      dispatchId,
      message: { runId },
      accountId,
      profileRef: "plus-primary",
      launchUrl: "https://chatgpt.com/g/ai-world",
      launcherId,
      attempt: 1,
      leaseExpiresAt: "2026-08-17T19:02:00.000Z",
    })),
    submitted: vi.fn(async () => ({
      schemaVersion: 1 as const,
      dispatchId,
      runId,
      accountId,
      profileRef: "plus-primary",
      launcherId,
      attempt: 1,
      submittedAt: "2026-08-17T19:00:01.000Z",
      receiptSha256: "b".repeat(64),
    })),
    failure: vi.fn(async () => "RETRY" as const),
    now: () => new Date("2026-08-17T19:00:00.000Z"),
  };
}

describe("Native Chat launcher HTTP control", () => {
  it("is disabled unless both fixed launcher identity and token hash are configured", async () => {
    expect(parseNativeChatLauncherControlConfiguration({})).toBeUndefined();
    expect(() =>
      parseNativeChatLauncherControlConfiguration({
        AGENT_WORLD_NATIVE_CHAT_LAUNCHER_ID: launcherId,
      }),
    ).toThrow();

    const handler = createNativeChatLauncherRouteHandler(dependencies(), undefined);
    expect(
      (await handler(request({ schemaVersion: 1, action: "CLAIM", leaseMs: 120_000 }))).status,
    ).toBe(503);
  });

  it("rejects an invalid bearer without touching the queue", async () => {
    const deps = dependencies();
    const handler = createNativeChatLauncherRouteHandler(deps, { launcherId, tokenSha256 });
    const response = await handler(
      request({ schemaVersion: 1, action: "CLAIM", leaseMs: 120_000 }, "z".repeat(43)),
    );
    expect(response.status).toBe(401);
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("claims with server-owned timestamps and the configured launcher identity", async () => {
    const deps = dependencies();
    const handler = createNativeChatLauncherRouteHandler(deps, { launcherId, tokenSha256 });
    const response = await handler(
      request({ schemaVersion: 1, action: "CLAIM", leaseMs: 120_000 }),
    );
    expect(response.status).toBe(200);
    expect(deps.claim).toHaveBeenCalledWith({
      launcherId,
      claimedAt: "2026-08-17T19:00:00.000Z",
      leaseExpiresAt: "2026-08-17T19:02:00.000Z",
    });
    expect(JSON.stringify(await response.json())).not.toContain(token);
  });

  it("records submission and failure without accepting client timestamps or launcher IDs", async () => {
    const deps = dependencies();
    const handler = createNativeChatLauncherRouteHandler(deps, { launcherId, tokenSha256 });

    const submitted = await handler(
      request({ schemaVersion: 1, action: "SUBMITTED", dispatchId, attempt: 1 }),
    );
    expect(submitted.status).toBe(200);
    expect(deps.submitted).toHaveBeenCalledWith({
      dispatchId,
      launcherId,
      attempt: 1,
      submittedAt: "2026-08-17T19:00:00.000Z",
    });

    const failure = await handler(
      request({
        schemaVersion: 1,
        action: "FAILURE",
        dispatchId,
        attempt: 1,
        failureCode: "CHAT_SUBMISSION_UNCONFIRMED",
        retryable: true,
      }),
    );
    expect(failure.status).toBe(200);
    expect(deps.failure).toHaveBeenCalledWith({
      dispatchId,
      launcherId,
      attempt: 1,
      failedAt: "2026-08-17T19:00:00.000Z",
      failureCode: "CHAT_SUBMISSION_UNCONFIRMED",
      retryable: true,
    });
  });
});
