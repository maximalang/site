import { LauncherIdSchema, type NativeChatLaunchClaim, TimestampSchema } from "@agent-world/domain";
import type { PostgresNativeChatLaunchStore } from "@agent-world/postgres-store";
import { type NativeChatBrowserDriver, NativeChatBrowserError } from "./driver.js";

type LaunchStore = Pick<
  PostgresNativeChatLaunchStore,
  "claimNext" | "markSubmitted" | "recordFailure"
>;

export type NativeChatLauncherOutcome = "IDLE" | "SUBMITTED" | "RETRY" | "FAILED";

export class NativeChatLauncherWorker {
  constructor(
    private readonly options: {
      store: LaunchStore;
      browser: NativeChatBrowserDriver;
      launcherId: string;
      leaseMs: number;
      now?: () => Date;
    },
  ) {}

  async runOnce(): Promise<{ outcome: NativeChatLauncherOutcome; claim?: NativeChatLaunchClaim }> {
    const launcherId = LauncherIdSchema.parse(this.options.launcherId);
    const now = this.options.now ?? (() => new Date());
    const claimedAt = now();
    const claim = await this.options.store.claimNext({
      launcherId,
      claimedAt: TimestampSchema.parse(claimedAt.toISOString()),
      leaseExpiresAt: TimestampSchema.parse(
        new Date(claimedAt.getTime() + this.options.leaseMs).toISOString(),
      ),
    });
    if (!claim) return { outcome: "IDLE" };
    try {
      await this.options.browser.submit(claim);
      await this.options.store.markSubmitted({
        dispatchId: claim.dispatchId,
        launcherId,
        attempt: claim.attempt,
        submittedAt: TimestampSchema.parse(now().toISOString()),
      });
      return { outcome: "SUBMITTED", claim };
    } catch (error) {
      const failureCode =
        error instanceof NativeChatBrowserError ? error.code : "CHAT_SUBMISSION_UNCONFIRMED";
      const outcome = await this.options.store.recordFailure({
        dispatchId: claim.dispatchId,
        launcherId,
        attempt: claim.attempt,
        failedAt: TimestampSchema.parse(now().toISOString()),
        failureCode,
        retryable: true,
      });
      return { outcome, claim };
    }
  }
}
