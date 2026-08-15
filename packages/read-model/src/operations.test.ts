import { describe, expect, it } from "vitest";
import { OperationsReadModelSchema } from "./operations.js";

describe("OperationsReadModelSchema", () => {
  it("keeps canonical Action Graph provenance separate from truthful observability", () => {
    const model = OperationsReadModelSchema.parse({
      schemaVersion: 1,
      generatedAt: "2026-08-15T12:00:00.000Z",
      actionGraph: {
        nodes: [
          {
            kind: "TASK",
            id: "task_11111111-1111-4111-8111-111111111111",
            label: "Verify evidence",
            agentId: "agent_22222222-2222-4222-8222-222222222222",
            status: "COMPLETED",
            occurredAt: "2026-08-15T11:00:00.000Z",
          },
          {
            kind: "RUN",
            id: "run_11111111-1111-4111-8111-111111111111",
            label: "Verify evidence",
            taskId: "task_11111111-1111-4111-8111-111111111111",
            agentId: "agent_22222222-2222-4222-8222-222222222222",
            status: "COMPLETED",
            adapterKind: "CODEX",
            occurredAt: "2026-08-15T11:01:00.000Z",
            resultSummary: "Evidence verified.",
          },
        ],
        edges: [
          {
            kind: "EXECUTION",
            fromTaskId: "task_11111111-1111-4111-8111-111111111111",
            toRunId: "run_11111111-1111-4111-8111-111111111111",
          },
        ],
      },
      observatory: {
        runs: { total: 1, completed: 1, failed: 0 },
        tokens: { input: 100, cachedInput: 40, output: 20 },
        context: { estimatedTokens: 80, budgetTokens: 200, pressure: 0.4 },
        monetaryCost: { status: "UNAVAILABLE" },
        routeSignals: [],
      },
    });
    expect(model.actionGraph.nodes[1]).toEqual(
      expect.objectContaining({ resultSummary: "Evidence verified." }),
    );
    expect(JSON.stringify(model)).not.toMatch(/account_|credential|session_/);
  });

  it("rejects invented monetary cost and unbounded pressure", () => {
    const base = {
      schemaVersion: 1,
      generatedAt: "2026-08-15T12:00:00.000Z",
      actionGraph: { nodes: [], edges: [] },
      observatory: {
        runs: { total: 0, completed: 0, failed: 0 },
        tokens: { input: 0, cachedInput: 0, output: 0 },
        context: { estimatedTokens: 0, budgetTokens: 0, pressure: 0 },
        monetaryCost: { status: "UNAVAILABLE", usd: 1 },
        routeSignals: [],
      },
    };
    expect(OperationsReadModelSchema.safeParse(base).success).toBe(false);
    expect(
      OperationsReadModelSchema.safeParse({
        ...base,
        observatory: {
          ...base.observatory,
          monetaryCost: { status: "UNAVAILABLE" },
          context: { estimatedTokens: 2, budgetTokens: 1, pressure: 2 },
        },
      }).success,
    ).toBe(false);
  });
});
