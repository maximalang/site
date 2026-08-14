import {
  NativeChatLaunchClaimSchema,
  NativeChatSubmissionReceiptSchema,
} from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import type { NativeChatBrowserDriver } from "./driver.js";
import { NativeChatLauncherWorker } from "./worker.js";

const claim = NativeChatLaunchClaimSchema.parse({
  schemaVersion: 1,
  dispatchId: "chat_dispatch_11111111-1111-1111-1111-111111111111",
  message: { runId: "run_22222222-2222-2222-2222-222222222222" },
  accountId: "account_33333333-3333-3333-3333-333333333333",
  profileRef: "plus-primary",
  launchUrl: "https://chatgpt.com/g/ai-world-agent",
  launcherId: "launcher_44444444-4444-4444-4444-444444444444",
  attempt: 1,
  leaseExpiresAt: "2026-08-14T10:02:00.000Z",
});

describe("NativeChatLauncherWorker", () => {
  it("records submission only after the browser accepts the short launch message", async () => {
    const store = {
      claimNext: vi.fn(async () => claim),
      markSubmitted: vi.fn(async (input) =>
        NativeChatSubmissionReceiptSchema.parse({
          schemaVersion: 1,
          dispatchId: claim.dispatchId,
          runId: claim.message.runId,
          accountId: claim.accountId,
          profileRef: claim.profileRef,
          launcherId: claim.launcherId,
          attempt: claim.attempt,
          submittedAt: input.submittedAt,
          receiptSha256: "a".repeat(64),
        }),
      ),
      recordFailure: vi.fn(async () => "RETRY" as const),
    };
    const browser: NativeChatBrowserDriver = {
      submit: vi.fn(async (value) => {
        expect(value.message).toEqual({ runId: claim.message.runId });
      }),
      close: vi.fn(async () => undefined),
    };
    const times = [new Date("2026-08-14T10:00:00.000Z"), new Date("2026-08-14T10:00:01.000Z")];
    const result = await new NativeChatLauncherWorker({
      store,
      browser,
      launcherId: claim.launcherId,
      leaseMs: 120_000,
      now: () => times.shift() ?? new Date("2026-08-14T10:00:01.000Z"),
    }).runOnce();

    expect(result.outcome).toBe("SUBMITTED");
    expect(store.markSubmitted).toHaveBeenCalledWith({
      dispatchId: claim.dispatchId,
      launcherId: claim.launcherId,
      attempt: 1,
      submittedAt: "2026-08-14T10:00:01.000Z",
    });
    expect(store.recordFailure).not.toHaveBeenCalled();
  });
});
