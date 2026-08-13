import { AgentIdSchema, ProjectIdSchema, TaskIdSchema } from "@agent-world/domain";
import { ExecutionPreferenceLayerSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresExecutionPreferenceStore } from "./execution-preference-store.js";

function pool(rows: unknown[][]) {
  const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [] as unknown[] }));
  for (const result of rows) query.mockResolvedValueOnce({ rows: result });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

const projectId = ProjectIdSchema.parse("project_11111111-1111-1111-1111-111111111111");
const agentId = AgentIdSchema.parse("agent_22222222-2222-2222-2222-222222222222");
const taskId = TaskIdSchema.parse("task_33333333-3333-3333-3333-333333333333");

describe("PostgresExecutionPreferenceStore", () => {
  it("resolves a validated Project/Agent/Task chain from sparse rows", async () => {
    const fake = pool([
      [],
      [{ valid: true }],
      [
        {
          scope_kind: "SYSTEM",
          project_id: null,
          agent_id: null,
          task_id: null,
          model_selection: "AUTO",
          model_id: null,
          account_selection: "AUTO",
          account_id: null,
          mode: "AUTO",
          context_policy: "AUTO",
          budget_policy: "BALANCED",
        },
        {
          scope_kind: "PROJECT",
          project_id: projectId,
          agent_id: null,
          task_id: null,
          model_selection: null,
          model_id: null,
          account_selection: null,
          account_id: null,
          mode: null,
          context_policy: "LEAN",
          budget_policy: null,
        },
        {
          scope_kind: "AGENT",
          project_id: null,
          agent_id: agentId,
          task_id: null,
          model_selection: null,
          model_id: null,
          account_selection: null,
          account_id: null,
          mode: "CODEX",
          context_policy: null,
          budget_policy: null,
        },
        {
          scope_kind: "TASK",
          project_id: null,
          agent_id: null,
          task_id: taskId,
          model_selection: null,
          model_id: null,
          account_selection: null,
          account_id: null,
          mode: null,
          context_policy: null,
          budget_policy: "QUALITY",
        },
      ],
    ]);
    const resolved = await new PostgresExecutionPreferenceStore(fake.value).resolve({
      projectId,
      agentId,
      taskId,
    });
    expect(resolved.mode).toEqual({ value: "CODEX", source: { kind: "AGENT", agentId } });
    expect(resolved.context).toEqual({ value: "LEAN", source: { kind: "PROJECT", projectId } });
    expect(resolved.budget).toEqual({ value: "QUALITY", source: { kind: "TASK", taskId } });
  });

  it("upserts only explicit local overrides", async () => {
    const fake = pool([[], [], []]);
    await new PostgresExecutionPreferenceStore(fake.value).writeLayer(
      ExecutionPreferenceLayerSchema.parse({
        schemaVersion: 1,
        scope: { kind: "AGENT", agentId },
        overrides: { mode: "CODEX", context: "LEAN" },
      }),
      "2026-08-13T12:00:00.000Z",
    );
    const upsert = fake.query.mock.calls.find(([sql]) => String(sql).includes("ON CONFLICT"));
    expect(upsert?.[1]).toEqual(
      expect.arrayContaining(["AGENT", agentId, "CODEX", "LEAN", "2026-08-13T12:00:00.000Z"]),
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("deletes an empty local layer so inherited values become visible", async () => {
    const fake = pool([[], [], []]);
    await new PostgresExecutionPreferenceStore(fake.value).writeLayer(
      ExecutionPreferenceLayerSchema.parse({
        schemaVersion: 1,
        scope: { kind: "PROJECT", projectId },
        overrides: {},
      }),
      "2026-08-13T12:00:00.000Z",
    );
    expect(
      fake.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM agent_world.execution_preference_overrides"),
      ),
    ).toBe(true);
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("rejects an unrelated Task chain before reading preferences", async () => {
    const fake = pool([
      [],
      [
        /* no canonical chain */
      ],
    ]);
    await expect(
      new PostgresExecutionPreferenceStore(fake.value).resolve({ projectId, agentId, taskId }),
    ).rejects.toThrow("INVALID_SCOPE_CHAIN");
    expect(fake.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
