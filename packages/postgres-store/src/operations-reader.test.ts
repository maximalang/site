import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresOperationsReader } from "./operations-reader.js";

function pool(results: unknown[][]) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  for (const rows of results) query.mockResolvedValueOnce({ rows });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}

describe("PostgresOperationsReader", () => {
  it("projects bounded graph provenance, token pressure and latest route signals", async () => {
    const fake = pool([
      [],
      [
        {
          id: "task_11111111-1111-4111-8111-111111111111",
          title: "Verify",
          assignee_agent_id: "agent_22222222-2222-4222-8222-222222222222",
          created_at: "2026-08-15T10:00:00.000Z",
          run_status: "COMPLETED",
        },
      ],
      [
        {
          id: "run_11111111-1111-4111-8111-111111111111",
          task_id: "task_11111111-1111-4111-8111-111111111111",
          agent_id: "agent_22222222-2222-4222-8222-222222222222",
          status: "COMPLETED",
          adapter_kind: "CODEX",
          created_at: "2026-08-15T10:01:00.000Z",
          title: "Verify",
          structured_result: { summary: "Verified" },
          final_output: null,
        },
      ],
      [],
      [
        {
          total: "1",
          completed: "1",
          failed: "0",
          input_tokens: "100",
          cached_input_tokens: "40",
          output_tokens: "20",
        },
      ],
      [{ estimated_tokens: "80", budget_tokens: "200" }],
      [
        {
          route_id: "route_33333333-3333-4333-8333-333333333333",
          is_available: true,
          quality: "0.9",
          remaining_limits: "0.8",
          cost: "0.7",
          speed: "0.6",
          load: "0.5",
          observed_at: "2026-08-15T11:00:00.000Z",
          expires_at: "2026-08-15T13:00:00.000Z",
        },
      ],
      [],
    ]);
    const model = await new PostgresOperationsReader(
      fake.value,
      () => new Date("2026-08-15T12:00:00.000Z"),
    ).read();
    expect(model.observatory.context.pressure).toBe(0.4);
    expect(model.observatory.routeSignals[0]).toEqual(
      expect.objectContaining({ isFresh: true, costEfficiency: 0.7 }),
    );
    expect(model.actionGraph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "RUN",
          resultSummary: JSON.stringify({ summary: "Verified" }),
        }),
      ]),
    );
    expect(JSON.stringify(model)).not.toMatch(/account_|session_|credential/);
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
