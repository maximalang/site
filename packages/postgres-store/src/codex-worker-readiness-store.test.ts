import { describe, expect, it, vi } from "vitest";
import { PostgresCodexWorkerReadinessStore } from "./codex-worker-readiness-store.js";
import type { TransactionPool } from "./conversation-store.js";

function database(validationRows: unknown[] = [{ id: "account_1" }]) {
  const query = vi.fn(async (text: string) => ({
    rows: text.includes("FROM agent_world.accounts") ? validationRows : [],
  }));
  const release = vi.fn();
  return {
    query,
    release,
    pool: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

const input = {
  workerId: "codex-worker-1",
  accountId: "account_11111111-1111-1111-1111-111111111111",
  authentication: "CHATGPT" as const,
  checkedAt: "2026-08-13T12:00:00.000Z",
};

describe("PostgresCodexWorkerReadinessStore", () => {
  it("atomically records a ChatGPT-ready worker and activates only its exact account", async () => {
    const fake = database();
    await expect(new PostgresCodexWorkerReadinessStore(fake.pool).report(input)).resolves.toEqual({
      status: "RECORDED",
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("a.auth_mechanism = 'CHATGPT_INTERACTIVE'"),
        expect.stringContaining("INSERT INTO agent_world.codex_worker_readiness"),
        expect.stringContaining("SET health = 'ACTIVE'"),
      ]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("records unavailable auth without falsely activating the account", async () => {
    const fake = database();
    await new PostgresCodexWorkerReadinessStore(fake.pool).report({
      ...input,
      authentication: "UNAVAILABLE",
    });
    const accountUpdate = fake.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE agent_world.accounts"),
    );
    expect(accountUpdate?.[0]).not.toContain("SET health = 'ACTIVE'");
  });

  it("fails closed when the configured account is not an enabled Codex account", async () => {
    const fake = database([]);
    await expect(new PostgresCodexWorkerReadinessStore(fake.pool).report(input)).rejects.toThrow(
      "CODEX_ACCOUNT_UNAVAILABLE",
    );
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
