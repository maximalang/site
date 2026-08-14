import { describe, expect, it, vi } from "vitest";
import { createMemoryRouteHandler } from "./memory-http";

const ids = {
  project: "project_11111111-1111-1111-1111-111111111111",
  proposal: "memory_proposal_22222222-2222-2222-2222-222222222222",
  decision: "memory_decision_33333333-3333-3333-3333-333333333333",
} as const;

describe("Memory HTTP", () => {
  it("returns only the requested validated owner projection", async () => {
    const inbox = vi.fn(async () => ({ schemaVersion: 1, projectId: ids.project, proposals: [] }));
    const handler = createMemoryRouteHandler({
      authorize: async () => true,
      inbox,
      timeline: async () => ({ schemaVersion: 1, projectId: ids.project, entries: [] }),
      network: async () => ({ schemaVersion: 1, projectId: ids.project, nodes: [], edges: [] }),
      decide: vi.fn(),
    });
    const response = await handler(
      new Request(`https://world.test/api/memory?projectId=${ids.project}&view=INBOX`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      projectId: ids.project,
      proposals: [],
    });
    expect(inbox).toHaveBeenCalledWith(ids.project, 100);
  });

  it("accepts a CSRF-authorized strict curator decision", async () => {
    const decide = vi.fn(async () => ({
      outcome: "CREATED",
      proposalId: ids.proposal,
      status: "REJECTED",
    }));
    const handler = createMemoryRouteHandler({
      authorize: async () => true,
      inbox: vi.fn(),
      timeline: vi.fn(),
      network: vi.fn(),
      decide,
    });
    const response = await handler(
      new Request("https://world.test/api/memory", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://world.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          schemaVersion: 1,
          id: ids.decision,
          proposalId: ids.proposal,
          projectId: ids.project,
          action: "REJECT",
          idempotencyKey: "memory:reject-ui",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(decide).toHaveBeenCalledOnce();
  });

  it("fails closed on unauthorized, cross-origin, or malformed requests", async () => {
    const dependencies = {
      authorize: async () => false,
      inbox: vi.fn(),
      timeline: vi.fn(),
      network: vi.fn(),
      decide: vi.fn(),
    };
    expect(
      (
        await createMemoryRouteHandler(dependencies)(
          new Request(`https://world.test/api/memory?projectId=${ids.project}&view=INBOX`),
        )
      ).status,
    ).toBe(401);

    const authorized = { ...dependencies, authorize: async () => true };
    expect(
      (
        await createMemoryRouteHandler(authorized)(
          new Request(`https://world.test/api/memory?projectId=${ids.project}&view=UNKNOWN`),
        )
      ).status,
    ).toBe(400);
  });
});
