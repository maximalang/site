import { TimestampSchema } from "@agent-world/domain";
import type { QueryResultRow } from "pg";
import type { TransactionPool, TransactionQueryResult } from "./conversation-store.js";

const TOKEN_HASH = /^[a-f0-9]{64}$/;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MILLISECONDS = 15 * 60 * 1_000;

type SessionRow = QueryResultRow & { expires_at: Date | string };

function validTokenHash(input: string): string {
  if (!TOKEN_HASH.test(input)) {
    throw new Error("Owner session token hash is invalid");
  }
  return input;
}

function timestamp(input: string): string {
  return TimestampSchema.parse(input);
}

function iso(input: Date | string): string {
  return input instanceof Date ? input.toISOString() : timestamp(input);
}

async function oneRow<Row extends QueryResultRow>(
  result: TransactionQueryResult<Row>,
): Promise<Row | undefined> {
  if (result.rows.length > 1) {
    throw new Error("Owner session query returned more than one row");
  }
  return result.rows[0];
}

export type OwnerSessionCreateInput = {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
};

export type OwnerSessionResolveInput = {
  tokenHash: string;
  now: string;
};

export type OwnerSessionRecord = {
  expiresAt: string;
};

export class PostgresOwnerSessionStore {
  constructor(private readonly pool: TransactionPool) {}

  async claimLoginAttempt(attemptedAtInput: string): Promise<"ALLOWED" | "BLOCKED"> {
    const attemptedAt = timestamp(attemptedAtInput);
    const windowEndsAt = new Date(
      Date.parse(attemptedAt) + LOGIN_WINDOW_MILLISECONDS,
    ).toISOString();
    const result = await this.query<{ attempt_count: number }>(
      `INSERT INTO agent_world.owner_auth_throttle
         (singleton, window_started_at, attempt_count, blocked_until)
       VALUES (true, $1, 1, NULL)
       ON CONFLICT (singleton) DO UPDATE
       SET window_started_at = CASE
             WHEN owner_auth_throttle.blocked_until <= $1
               OR owner_auth_throttle.window_started_at + interval '15 minutes' <= $1
             THEN $1 ELSE owner_auth_throttle.window_started_at END,
           attempt_count = CASE
             WHEN owner_auth_throttle.blocked_until <= $1
               OR owner_auth_throttle.window_started_at + interval '15 minutes' <= $1
             THEN 1 ELSE owner_auth_throttle.attempt_count + 1 END,
           blocked_until = CASE
             WHEN owner_auth_throttle.blocked_until <= $1
               OR owner_auth_throttle.window_started_at + interval '15 minutes' <= $1
             THEN NULL
             WHEN owner_auth_throttle.attempt_count + 1 >= $2 THEN $3::timestamptz
             ELSE NULL END
       WHERE owner_auth_throttle.blocked_until IS NULL
          OR owner_auth_throttle.blocked_until <= $1
       RETURNING attempt_count`,
      [attemptedAt, MAX_LOGIN_ATTEMPTS, windowEndsAt],
    );
    const row = await oneRow(result);
    if (!row) {
      return "BLOCKED";
    }
    if (!Number.isInteger(row.attempt_count) || row.attempt_count < 1) {
      throw new Error("Owner login throttle returned invalid state");
    }
    return "ALLOWED";
  }

  async resetLoginThrottle(nowInput: string): Promise<void> {
    const now = timestamp(nowInput);
    await this.query(
      `INSERT INTO agent_world.owner_auth_throttle
         (singleton, window_started_at, attempt_count, blocked_until)
       VALUES (true, $1, 0, NULL)
       ON CONFLICT (singleton) DO UPDATE
       SET window_started_at = $1, attempt_count = 0, blocked_until = NULL`,
      [now],
    );
  }

  async createSession(input: OwnerSessionCreateInput): Promise<void> {
    const tokenHash = validTokenHash(input.tokenHash);
    const createdAt = timestamp(input.createdAt);
    const expiresAt = timestamp(input.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
      throw new Error("Owner session expiry must follow creation");
    }
    await this.query(
      `INSERT INTO agent_world.owner_sessions
         (token_hash, created_at, expires_at)
       VALUES ($1, $2, $3)`,
      [tokenHash, createdAt, expiresAt],
    );
  }

  async resolveSession(input: OwnerSessionResolveInput): Promise<OwnerSessionRecord | undefined> {
    const tokenHash = validTokenHash(input.tokenHash);
    const now = timestamp(input.now);
    const row = await oneRow(
      await this.query<SessionRow>(
        `SELECT expires_at
           FROM agent_world.owner_sessions
          WHERE token_hash = $1
            AND revoked_at IS NULL
            AND expires_at > $2`,
        [tokenHash, now],
      ),
    );
    return row ? { expiresAt: iso(row.expires_at) } : undefined;
  }

  async revokeSession(tokenHashInput: string, revokedAtInput: string): Promise<void> {
    const tokenHash = validTokenHash(tokenHashInput);
    const revokedAt = timestamp(revokedAtInput);
    await this.query(
      `UPDATE agent_world.owner_sessions
          SET revoked_at = $2
        WHERE token_hash = $1
          AND revoked_at IS NULL`,
      [tokenHash, revokedAt],
    );
  }

  async pruneExpiredSessions(nowInput: string): Promise<number> {
    const now = timestamp(nowInput);
    const result = await this.query<{ deleted_count: number }>(
      `WITH deleted AS (
         DELETE FROM agent_world.owner_sessions
          WHERE expires_at <= $1 OR revoked_at <= $1 - interval '7 days'
          RETURNING 1
       )
       SELECT count(*)::integer AS deleted_count FROM deleted`,
      [now],
    );
    const row = await oneRow(result);
    if (!row || !Number.isInteger(row.deleted_count) || row.deleted_count < 0) {
      throw new Error("Owner session cleanup returned invalid state");
    }
    return row.deleted_count;
  }

  private async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<TransactionQueryResult<Row>> {
    const client = await this.pool.connect();
    try {
      return await client.query<Row>(text, values);
    } finally {
      client.release();
    }
  }
}
