import { HubReadModelSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import { createHubRouteHandler } from "./route";

const request = new Request("https://world.test/api/hub");
const fixture = HubReadModelSchema.parse({
  schemaVersion: 1,
  generatedAt: "2026-08-13T12:00:00.000Z",
  providers: [],
  accounts: [],
  models: [],
  executionRoutes: [],
  agents: [],
  skills: [],
  tools: [],
  projects: [],
});

describe("GET /api/hub", () => {
  it("returns one validated owner-only no-store Hub response", async () => {
    const response = await createHubRouteHandler(
      async () => fixture,
      async () => true,
    )(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(HubReadModelSchema.parse(body)).toEqual(fixture);
  });

  it("authorizes before reading and fails closed for rejected authorization", async () => {
    const read = vi.fn(async () => fixture);
    for (const authorize of [async () => false, async () => Promise.reject(new Error("secret"))]) {
      const response = await createHubRouteHandler(read, authorize)(request);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("secret");
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not reflect malformed projection data or reader exceptions", async () => {
    const handlers = [
      createHubRouteHandler(
        async () => ({ ...fixture, credentialRef: "vault:private" }),
        async () => true,
      ),
      createHubRouteHandler(
        async () => Promise.reject(new Error("database-password-must-not-leak")),
        async () => true,
      ),
    ];

    for (const handler of handlers) {
      const response = await handler(request);
      const body = await response.text();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(body).toContain("HUB_READ_MODEL_UNAVAILABLE");
      expect(body).not.toMatch(/vault:private|database-password/);
    }
  });
});
