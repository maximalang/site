import { compileContextPack } from "@agent-world/conversation-service";
import { describe, expect, it, vi } from "vitest";
import { ContextPackStoreError, type PostgresContextPackStore } from "./context-pack-store.js";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresRunContextPackProvider } from "./run-context-pack-provider.js";

vi.mock("@agent-world/conversation-service", () => ({
  compileContextPack: vi.fn(() => ({ schemaVersion: 1, id: "pack_test" })),
}));

function pool(rows: unknown[][]) {
  const query = vi.fn();
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresRunContextPackProvider", () => {
  it("loads canonical project state independently from the relevance-ranked context window", async () => {
    const compiledAt = "2026-08-19T01:30:00.000Z";
    const fake = pool([
      [
        {
          run_id: "run_11111111-1111-1111-1111-111111111111",
          task_id: "task_11111111-1111-1111-1111-111111111111",
          agent_id: "agent_22222222-2222-2222-2222-222222222222",
          project_id: "project_33333333-3333-3333-3333-333333333333",
          task_title: "Investigate memory drift",
          task_description: "Use canonical state",
          task_idempotency_key: "task:memory-drift",
          task_created_at: "2026-08-19T01:00:00.000Z",
          project_name: "AI World",
          agent_slug: "researcher",
          agent_display_name: "Researcher",
          agent_role: "Research",
          agent_instructions: "Verify before acting.",
          agent_is_enabled: true,
          route_id: "route_44444444-4444-4444-4444-444444444444",
          route_label: "OpenClaw",
          route_mode: "CHAT",
          route_adapter_kind: "OPENCLAW",
          route_account_id: null,
          route_is_enabled: true,
        },
      ],
      [{ content: "Newest canonical project state" }],
      [],
      [],
    ]);
    const store = {
      readByRun: vi.fn(async () => {
        throw new ContextPackStoreError("NOT_FOUND");
      }),
      persist: vi.fn(async () => ({ outcome: "CREATED", contextPackId: "pack_test" })),
    } as unknown as PostgresContextPackStore;

    await new PostgresRunContextPackProvider(fake.value, {
      store,
      packId: () => "pack_55555555-5555-5555-5555-555555555555",
      now: () => compiledAt,
    }).prepare("run_11111111-1111-1111-1111-111111111111");

    expect(fake.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("RUN_CONTEXT_PROJECT_STATE"),
      ["project_33333333-3333-3333-3333-333333333333", compiledAt],
    );
    const projectStateQuery = String(fake.query.mock.calls[1]?.[0]);
    expect(projectStateQuery).toContain("created_at <= $2");
    expect(projectStateQuery).toContain("ORDER BY created_at DESC, id DESC");
    expect(fake.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("ORDER BY relevance DESC"),
      [
        "project_33333333-3333-3333-3333-333333333333",
        compiledAt,
        "Investigate memory drift Use canonical state",
      ],
    );
    const optionalContextQuery = String(fake.query.mock.calls[2]?.[0]);
    expect(optionalContextQuery).toContain("kind <> 'PROJECT_STATE'");
    expect(optionalContextQuery).toContain("created_at <= $2");
    expect(vi.mocked(compileContextPack)).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ state: "Newest canonical project state" }),
      }),
      [],
      compiledAt,
    );
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
