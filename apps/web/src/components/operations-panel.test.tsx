// @vitest-environment jsdom

import { OperationsReadModelSchema } from "@agent-world/read-model";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OperationsPanel } from "./operations-panel";

afterEach(cleanup);
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
    ],
    edges: [],
  },
  observatory: {
    runs: { total: 1, completed: 1, failed: 0 },
    tokens: { input: 100, cachedInput: 40, output: 20 },
    context: { estimatedTokens: 80, budgetTokens: 200, pressure: 0.4 },
    monetaryCost: { status: "UNAVAILABLE" },
    routeSignals: [],
  },
});

describe("OperationsPanel", () => {
  it("shows truthful simple metrics and opt-in advanced provenance", async () => {
    render(<OperationsPanel load={async () => model} />);
    expect(await screen.findByText("Verify evidence")).toBeTruthy();
    expect(screen.getByText("Нет достоверных данных")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByText(/Cached input: 40/)).toBeTruthy();
  });
});
