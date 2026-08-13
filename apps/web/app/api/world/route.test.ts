import { WorldReadModelSchema } from "@agent-world/read-model";
import { describe, expect, it } from "vitest";
import { createWorldRouteHandler, GET } from "./route";

describe("GET /api/world", () => {
  it("returns one validated no-store read-model response", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(WorldReadModelSchema.parse(body)).toEqual(body);
  });

  it("fails closed without reflecting malformed provider data or exceptions", async () => {
    const malformed = createWorldRouteHandler(async () => ({
      source: "LIVE",
      credential: "must-not-leak",
    }));
    const throwing = createWorldRouteHandler(async () => {
      throw new Error("gateway-secret-must-not-leak");
    });

    for (const handler of [malformed, throwing]) {
      const response = await handler();
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(body).toContain("WORLD_READ_MODEL_UNAVAILABLE");
      expect(body).not.toMatch(/must-not-leak|credential|gateway-secret/);
    }
  });
});
