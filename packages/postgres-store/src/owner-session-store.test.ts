import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresOwnerSessionStore } from "./owner-session-store.js";

const hash = "a".repeat(64);

function pool(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows }));
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return {
    query,
    release,
    connect,
    value: { connect } as unknown as TransactionPool,
  };
}

describe("PostgresOwnerSessionStore", () => {
  it("persists only a validated token hash and bounded lifetime", async () => {
    const fake = pool();
    const store = new PostgresOwnerSessionStore(fake.value);

    await store.createSession({
      tokenHash: hash,
      createdAt: "2026-08-13T10:00:00.000Z",
      expiresAt: "2026-08-13T22:00:00.000Z",
    });

    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("owner_sessions"), [
      hash,
      "2026-08-13T10:00:00.000Z",
      "2026-08-13T22:00:00.000Z",
    ]);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("fails before opening a connection for raw, malformed or inverted session input", async () => {
    const fake = pool();
    const store = new PostgresOwnerSessionStore(fake.value);

    await expect(
      store.createSession({
        tokenHash: "raw-owner-cookie",
        createdAt: "2026-08-13T10:00:00.000Z",
        expiresAt: "2026-08-13T22:00:00.000Z",
      }),
    ).rejects.toThrow("hash");
    await expect(
      store.createSession({
        tokenHash: hash,
        createdAt: "2026-08-13T22:00:00.000Z",
        expiresAt: "2026-08-13T10:00:00.000Z",
      }),
    ).rejects.toThrow("expiry");
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it("resolves only one active session and normalizes database timestamps", async () => {
    const fake = pool([{ expires_at: new Date("2026-08-13T22:00:00.000Z") }]);
    const store = new PostgresOwnerSessionStore(fake.value);

    await expect(
      store.resolveSession({ tokenHash: hash, now: "2026-08-13T10:00:00.000Z" }),
    ).resolves.toEqual({ expiresAt: "2026-08-13T22:00:00.000Z" });
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("revoked_at IS NULL"), [
      hash,
      "2026-08-13T10:00:00.000Z",
    ]);
  });

  it("maps an atomic throttle no-row result to blocked without exposing database details", async () => {
    const blocked = pool([]);
    const allowed = pool([{ attempt_count: 1 }]);

    await expect(
      new PostgresOwnerSessionStore(blocked.value).claimLoginAttempt("2026-08-13T10:00:00.000Z"),
    ).resolves.toBe("BLOCKED");
    await expect(
      new PostgresOwnerSessionStore(allowed.value).claimLoginAttempt("2026-08-13T10:00:00.000Z"),
    ).resolves.toBe("ALLOWED");
  });

  it("revokes by hash and prunes only expired or long-revoked sessions", async () => {
    const revoke = pool();
    const cleanup = pool([{ deleted_count: 2 }]);
    await new PostgresOwnerSessionStore(revoke.value).revokeSession(
      hash,
      "2026-08-13T10:00:00.000Z",
    );
    await expect(
      new PostgresOwnerSessionStore(cleanup.value).pruneExpiredSessions("2026-08-13T10:00:00.000Z"),
    ).resolves.toBe(2);
    expect(revoke.query).toHaveBeenCalledWith(expect.stringContaining("SET revoked_at"), [
      hash,
      "2026-08-13T10:00:00.000Z",
    ]);
    expect(cleanup.query).toHaveBeenCalledWith(expect.stringContaining("interval '7 days'"), [
      "2026-08-13T10:00:00.000Z",
    ]);
  });
});
