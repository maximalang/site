import { WorldReadModelSchema } from "@agent-world/read-model";
import { describe, expect, it } from "vitest";
import { createWorldRouteHandler } from "./route";

const request = new Request("https://world.test/api/world");

describe("GET /api/world", () => {
  it("returns one validated no-store read-model response", async () => {
    const response = await createWorldRouteHandler(
      async () =>
        WorldReadModelSchema.parse({
          schemaVersion: 1,
          source: "UNAVAILABLE",
          generatedAt: "2026-08-13T10:00:00.000Z",
          cursor: { schemaVersion: 1, stream: "WORLD", lastSequence: 0 },
          agents: [],
          tasks: [],
        }),
      async () => true,
    )(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(WorldReadModelSchema.parse(body)).toEqual(body);
  });

  it("fails closed without reflecting malformed provider data or exceptions", async () => {
    const malformed = createWorldRouteHandler(
      async () => ({ source: "LIVE", credential: "must-not-leak" }),
      async () => true,
    );
    const throwing = createWorldRouteHandler(
      async () => {
        throw new Error("gateway-secret-must-not-leak");
      },
      async () => true,
    );

    for (const handler of [malformed, throwing]) {
      const response = await handler(request);
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(body).toContain("WORLD_READ_MODEL_UNAVAILABLE");
      expect(body).not.toMatch(/must-not-leak|credential|gateway-secret/);
    }
  });

  it("authorizes before reading and fails closed on missing or throwing auth", async () => {
    for (const authorize of [async () => false, async () => Promise.reject(new Error("secret"))]) {
      let reads = 0;
      const response = await createWorldRouteHandler(async () => {
        reads += 1;
        return {};
      }, authorize)(request);
      expect(response.status).toBe(401);
      expect(reads).toBe(0);
      expect(await response.text()).not.toContain("secret");
    }
  });
});
