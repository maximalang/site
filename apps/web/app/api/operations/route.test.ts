import { describe, expect, it } from "vitest";
import { createOperationsRouteHandler } from "./route";

const fixture = {
  schemaVersion: 1 as const,
  generatedAt: "2026-08-15T12:00:00.000Z",
  actionGraph: { nodes: [], edges: [] },
  observatory: {
    runs: { total: 0, completed: 0, failed: 0 },
    tokens: { input: 0, cachedInput: 0, output: 0 },
    context: { estimatedTokens: 0, budgetTokens: 0, pressure: 0 },
    monetaryCost: { status: "UNAVAILABLE" as const },
    routeSignals: [],
  },
};

describe("GET /api/operations", () => {
  it("authorizes and returns a validated no-store projection", async () => {
    const response = await createOperationsRouteHandler(
      async () => fixture,
      async () => true,
    )(new Request("https://world.test/api/operations"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(fixture);
  });

  it("fails closed without reading before authorization", async () => {
    let reads = 0;
    const response = await createOperationsRouteHandler(
      async () => {
        reads += 1;
        return fixture;
      },
      async () => false,
    )(new Request("https://world.test/api/operations"));
    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });
});
