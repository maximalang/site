import { describe, expect, it, vi } from "vitest";
import { PostgresNativeChatResourceReader } from "./native-chat-resource-reader.js";

const ids = {
  account: "account_11111111-1111-1111-1111-111111111111",
  otherAccount: "account_22222222-2222-2222-2222-222222222222",
  run: "run_33333333-3333-3333-3333-333333333333",
  task: "task_44444444-4444-4444-4444-444444444444",
  project: "project_55555555-5555-5555-5555-555555555555",
  agent: "agent_66666666-6666-6666-6666-666666666666",
  route: "route_77777777-7777-7777-7777-777777777777",
  pull: "resource_pull_88888888-8888-8888-8888-888888888888",
  skill: "skill_99999999-9999-9999-9999-999999999999",
};

const occurredAt = "2026-08-14T19:00:00.000Z";
const scope = {
  run_id: ids.run,
  account_id: ids.account,
  dispatch_state: "ATTACHED",
  last_sequence: 1,
  run_status: "RUNNING",
  run_created_at: occurredAt,
  task_id: ids.task,
  task_title: "Implement lazy context",
  task_description: "Return bounded canonical resources.",
  task_created_at: occurredAt,
  project_id: ids.project,
  project_name: "AI World",
  project_slug: "ai-world",
  project_created_at: occurredAt,
  agent_id: ids.agent,
  agent_slug: "builder",
  agent_display_name: "Builder",
  agent_role: "Implementation",
  agent_instructions: "Use canonical evidence.",
  agent_created_at: occurredAt,
  route_id: ids.route,
};

function harness(scopeOverride: Partial<typeof scope> = {}) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes("FROM agent_world.native_chat_dispatches"))
      return { rows: [{ ...scope, ...scopeOverride }], rowCount: 1 };
    if (sql.includes("FROM agent_world.agent_skills"))
      return {
        rows: [
          {
            id: ids.skill,
            slug: "source-research",
            display_name: "Source research",
            version: "1.0.0",
            description: "Read authoritative sources.",
            source_kind: "LOCAL_PATH",
            source_ref: "skills/source-research/SKILL.md",
            integrity_sha256: "a".repeat(64),
            created_at: occurredAt,
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("FROM agent_world.native_chat_control_events"))
      return {
        rows: [
          {
            sequence: 1,
            event_type: "BEGIN_RUN",
            payload: {},
            event_sha256: "b".repeat(64),
            occurred_at: occurredAt,
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("INSERT INTO agent_world.native_chat_resource_pulls"))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  return {
    query,
    reader: new PostgresNativeChatResourceReader(pool as never, {
      pullId: () => ids.pull,
      now: () => new Date(occurredAt),
    }),
  };
}

describe("PostgresNativeChatResourceReader", () => {
  it("returns only requested canonical resources with hashes, provenance, and a receipt", async () => {
    const { reader, query } = harness();
    const response = await reader.pull(ids.account, {
      schemaVersion: 1,
      runId: ids.run,
      resources: ["TASK", "PROJECT_STATE", "SKILLS", "ACTION_HISTORY", "MEMORY"],
      maxItems: 10,
      maxTokens: 4_000,
    });
    expect(response.items.map((item) => item.resource)).toEqual([
      "TASK",
      "PROJECT_STATE",
      "SKILLS",
      "ACTION_HISTORY",
    ]);
    expect(response.items.every((item) => item.contentSha256.length === 64)).toBe(true);
    expect(response.omissions).toContainEqual({ resource: "MEMORY", reason: "UNAVAILABLE" });
    expect(response.estimatedTokens).toBeLessThanOrEqual(response.maxTokens);
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("native_chat_resource_pulls"),
    );
    expect(insert?.[1]).toEqual(
      expect.arrayContaining([ids.pull, ids.run, ids.account, 10, 4_000, 4]),
    );
  });

  it("fails closed across Accounts and before begin_run", async () => {
    await expect(
      harness().reader.pull(ids.otherAccount, {
        schemaVersion: 1,
        runId: ids.run,
        resources: ["TASK"],
        maxItems: 1,
        maxTokens: 500,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
    await expect(
      harness({ dispatch_state: "BROWSER_SUBMITTED", last_sequence: 0 }).reader.pull(ids.account, {
        schemaVersion: 1,
        runId: ids.run,
        resources: ["TASK"],
        maxItems: 1,
        maxTokens: 500,
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_ATTACHED" });
  });

  it("omits whole items instead of silently exceeding the token budget", async () => {
    const response = await harness().reader.pull(ids.account, {
      schemaVersion: 1,
      runId: ids.run,
      resources: ["TASK", "PROJECT_STATE"],
      maxItems: 10,
      maxTokens: 64,
    });
    expect(response.estimatedTokens).toBeLessThanOrEqual(64);
    expect(response.omissions.some((item) => item.reason === "TOKEN_BUDGET")).toBe(true);
  });
});
