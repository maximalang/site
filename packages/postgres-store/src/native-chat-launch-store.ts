import { createHash } from "node:crypto";
import {
  AccountIdSchema,
  BrowserProfileRefSchema,
  ChatDispatchIdSchema,
  LauncherIdSchema,
  type NativeChatLaunchClaim,
  NativeChatLaunchClaimSchema,
  NativeChatLaunchUrlSchema,
  type NativeChatSubmissionReceipt,
  NativeChatSubmissionReceiptSchema,
  TimestampSchema,
} from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import * as z from "zod";
import type { TransactionPool } from "./conversation-store.js";

const ProfileSchema = z.strictObject({
  accountId: AccountIdSchema,
  profileRef: BrowserProfileRefSchema,
  launchUrl: NativeChatLaunchUrlSchema,
  isEnabled: z.boolean(),
  updatedAt: TimestampSchema,
});

const ClaimSchema = z
  .strictObject({
    launcherId: LauncherIdSchema,
    claimedAt: TimestampSchema,
    leaseExpiresAt: TimestampSchema,
  })
  .refine((claim) => {
    const duration = Date.parse(claim.leaseExpiresAt) - Date.parse(claim.claimedAt);
    return duration >= 10_000 && duration <= 5 * 60_000;
  }, "Native Chat launch lease must be between 10 seconds and 5 minutes");

const CompleteSchema = z.strictObject({
  dispatchId: ChatDispatchIdSchema,
  launcherId: LauncherIdSchema,
  attempt: z.number().int().min(1).max(10),
  submittedAt: TimestampSchema,
});

const FailureSchema = z.strictObject({
  dispatchId: ChatDispatchIdSchema,
  launcherId: LauncherIdSchema,
  attempt: z.number().int().min(1).max(10),
  failedAt: TimestampSchema,
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  retryable: z.boolean(),
});

type ClaimRow = QueryResultRow & {
  id: string;
  run_id: string;
  account_id: string;
  profile_ref: string;
  launch_url: string;
  launch_attempt: number;
};

type SubmissionRow = ClaimRow & { browser_profile_ref: string };

export type NativeChatLaunchStoreErrorCode =
  | "PROFILE_CONFLICT"
  | "CLAIM_CONFLICT"
  | "SUBMISSION_CONFLICT";

export class NativeChatLaunchStoreError extends Error {
  constructor(readonly code: NativeChatLaunchStoreErrorCode) {
    super(code);
    this.name = "NativeChatLaunchStoreError";
  }
}

function hashReceipt(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class PostgresNativeChatLaunchStore {
  constructor(private readonly pool: TransactionPool) {}

  async configureProfile(input: z.input<typeof ProfileSchema>): Promise<void> {
    const profile = ProfileSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO agent_world.native_chat_browser_profiles
           (account_id, profile_ref, launch_url, is_enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id) DO UPDATE SET
           profile_ref = EXCLUDED.profile_ref,
           launch_url = EXCLUDED.launch_url,
           is_enabled = EXCLUDED.is_enabled,
           updated_at = EXCLUDED.updated_at`,
        [
          profile.accountId,
          profile.profileRef,
          profile.launchUrl,
          profile.isEnabled,
          profile.updatedAt,
        ],
      );
    } catch {
      throw new NativeChatLaunchStoreError("PROFILE_CONFLICT");
    } finally {
      client.release();
    }
  }

  async claimNext(input: z.input<typeof ClaimSchema>): Promise<NativeChatLaunchClaim | undefined> {
    const request = ClaimSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<ClaimRow>(
        `SELECT dispatch.id, dispatch.run_id, dispatch.account_id, profile.profile_ref,
                profile.launch_url,
                dispatch.launch_attempt
           FROM agent_world.native_chat_dispatches dispatch
           JOIN agent_world.runs run
             ON run.id = dispatch.run_id AND run.status = 'DISPATCH_PENDING'
           JOIN agent_world.accounts account
             ON account.id = dispatch.account_id
            AND account.is_enabled = true
            AND account.health IN ('ACTIVE', 'DEGRADED')
           JOIN agent_world.native_chat_browser_profiles profile
             ON profile.account_id = dispatch.account_id AND profile.is_enabled = true
          WHERE dispatch.state = 'QUEUED'
            AND dispatch.launch_attempt < 10
            AND (dispatch.lease_expires_at IS NULL OR dispatch.lease_expires_at <= $1)
          ORDER BY dispatch.created_at, dispatch.id
          FOR UPDATE OF dispatch SKIP LOCKED
          LIMIT 1`,
        [request.claimedAt],
      );
      const row = selected.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }
      const updated = await client.query<ClaimRow>(
        `UPDATE agent_world.native_chat_dispatches
            SET launch_attempt = launch_attempt + 1,
                lease_owner = $2,
                lease_expires_at = $3
          WHERE id = $1 AND state = 'QUEUED'
        RETURNING id, run_id, account_id, launch_attempt`,
        [row.id, request.launcherId, request.leaseExpiresAt],
      );
      if (updated.rows.length !== 1 || !updated.rows[0]) {
        throw new NativeChatLaunchStoreError("CLAIM_CONFLICT");
      }
      const claim = NativeChatLaunchClaimSchema.parse({
        schemaVersion: 1,
        dispatchId: updated.rows[0].id,
        message: { runId: updated.rows[0].run_id },
        accountId: updated.rows[0].account_id,
        profileRef: row.profile_ref,
        launchUrl: row.launch_url,
        launcherId: request.launcherId,
        attempt: updated.rows[0].launch_attempt,
        leaseExpiresAt: request.leaseExpiresAt,
      });
      await client.query("COMMIT");
      return claim;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markSubmitted(input: z.input<typeof CompleteSchema>): Promise<NativeChatSubmissionReceipt> {
    const completion = CompleteSchema.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query<SubmissionRow>(
        `SELECT dispatch.id, dispatch.run_id, dispatch.account_id,
                dispatch.launch_attempt, profile.profile_ref,
                dispatch.browser_profile_ref
           FROM agent_world.native_chat_dispatches dispatch
           JOIN agent_world.native_chat_browser_profiles profile
             ON profile.account_id = dispatch.account_id
          WHERE dispatch.id = $1
            AND dispatch.state = 'QUEUED'
            AND dispatch.lease_owner = $2
            AND dispatch.launch_attempt = $3
            AND dispatch.lease_expires_at >= $4
          FOR UPDATE OF dispatch`,
        [completion.dispatchId, completion.launcherId, completion.attempt, completion.submittedAt],
      );
      const row = current.rows[0];
      if (!row || current.rows.length !== 1) {
        throw new NativeChatLaunchStoreError("SUBMISSION_CONFLICT");
      }
      const unsigned = {
        schemaVersion: 1 as const,
        dispatchId: completion.dispatchId,
        runId: row.run_id,
        accountId: row.account_id,
        profileRef: row.profile_ref,
        launcherId: completion.launcherId,
        attempt: completion.attempt,
        submittedAt: completion.submittedAt,
      };
      const receipt = NativeChatSubmissionReceiptSchema.parse({
        ...unsigned,
        receiptSha256: hashReceipt(unsigned),
      });
      const updated = await client.query(
        `UPDATE agent_world.native_chat_dispatches
            SET state = 'BROWSER_SUBMITTED', submitted_at = $2,
                browser_profile_ref = $3, submission_receipt_sha256 = $4,
                submission_evidence_version = 1,
                lease_owner = NULL, lease_expires_at = NULL,
                last_launch_failure_code = NULL
          WHERE id = $1 AND state = 'QUEUED'
        RETURNING id`,
        [completion.dispatchId, completion.submittedAt, row.profile_ref, receipt.receiptSha256],
      );
      if (updated.rows.length !== 1) throw new NativeChatLaunchStoreError("SUBMISSION_CONFLICT");
      await client.query("COMMIT");
      return receipt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordFailure(input: z.input<typeof FailureSchema>): Promise<"RETRY" | "FAILED"> {
    const failure = FailureSchema.parse(input);
    const client = await this.pool.connect();
    try {
      const retry = failure.retryable && failure.attempt < 10;
      const result = await client.query(
        retry
          ? `UPDATE agent_world.native_chat_dispatches
                SET lease_owner = NULL, lease_expires_at = NULL,
                    last_launch_failure_code = $4
              WHERE id = $1 AND state = 'QUEUED'
                AND lease_owner = $2 AND launch_attempt = $3
            RETURNING id`
          : `UPDATE agent_world.native_chat_dispatches
                SET state = 'FAILED', failed_at = $5, failure_code = $4,
                    lease_owner = NULL, lease_expires_at = NULL,
                    last_launch_failure_code = $4
              WHERE id = $1 AND state = 'QUEUED'
                AND lease_owner = $2 AND launch_attempt = $3
            RETURNING id`,
        retry
          ? [failure.dispatchId, failure.launcherId, failure.attempt, failure.failureCode]
          : [
              failure.dispatchId,
              failure.launcherId,
              failure.attempt,
              failure.failureCode,
              failure.failedAt,
            ],
      );
      if (result.rows.length !== 1) throw new NativeChatLaunchStoreError("CLAIM_CONFLICT");
      return retry ? "RETRY" : "FAILED";
    } finally {
      client.release();
    }
  }
}
