import {
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  resolveExecutionPreferences,
} from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import { createExecutionPreferenceRouteHandler } from "./execution-preference-http";

const system = ExecutionPreferenceLayerSchema.parse({
  schemaVersion: 1,
  scope: { kind: "SYSTEM" },
  overrides: {
    model: { kind: "AUTO" },
    account: { kind: "AUTO" },
    mode: "AUTO",
    context: "AUTO",
    budget: "BALANCED",
  },
});
const readModel = ExecutionPreferenceReadModelSchema.parse({
  schemaVersion: 1,
  selection: {},
  local: system,
  resolved: resolveExecutionPreferences([system]),
});

function dependencies() {
  return {
    authorize: vi.fn(async () => true),
    read: vi.fn(async () => readModel),
    write: vi.fn(async () => undefined),
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  };
}

describe("execution preference HTTP", () => {
  it("returns a strict owner-only no-store read model", async () => {
    const value = dependencies();
    const response = await createExecutionPreferenceRouteHandler(value)(
      new Request("https://world.test/api/hub/preferences"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(readModel);
    expect(value.read).toHaveBeenCalledWith({});
  });

  it("rejects unknown, duplicate and incomplete scope queries", async () => {
    const handler = createExecutionPreferenceRouteHandler(dependencies());
    for (const query of ["?secret=x", "?agentId=x&agentId=y", "?taskId=x"]) {
      const response = await handler(new Request(`https://world.test/api/hub/preferences${query}`));
      expect(response.status).toBe(400);
    }
  });

  it("writes absolute sparse overrides only with same-origin authorization", async () => {
    const value = dependencies();
    const handler = createExecutionPreferenceRouteHandler(value);
    const layer = ExecutionPreferenceLayerSchema.parse({
      schemaVersion: 1,
      scope: { kind: "AGENT", agentId: "agent_11111111-1111-1111-1111-111111111111" },
      overrides: { mode: "CODEX" },
    });
    const response = await handler(
      new Request("https://world.test/api/hub/preferences", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          host: "world.test",
          origin: "https://world.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify(layer),
      }),
    );
    expect(response.status).toBe(204);
    expect(value.write).toHaveBeenCalledWith(layer, "2026-08-13T12:00:00.000Z");
  });

  it("fails closed before reads and cross-origin writes", async () => {
    const unauthorized = dependencies();
    unauthorized.authorize.mockResolvedValue(false);
    expect(
      (
        await createExecutionPreferenceRouteHandler(unauthorized)(
          new Request("https://world.test/api/hub/preferences"),
        )
      ).status,
    ).toBe(401);
    const response = await createExecutionPreferenceRouteHandler(dependencies())(
      new Request("https://world.test/api/hub/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json", origin: "https://attacker.test" },
        body: JSON.stringify(system),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("does not misreport dependency failures as caller errors", async () => {
    const readFailure = dependencies();
    readFailure.read.mockRejectedValue(new Error("database unavailable"));
    expect(
      (
        await createExecutionPreferenceRouteHandler(readFailure)(
          new Request("https://world.test/api/hub/preferences"),
        )
      ).status,
    ).toBe(503);

    const writeFailure = dependencies();
    writeFailure.write.mockRejectedValue(new Error("database unavailable"));
    const response = await createExecutionPreferenceRouteHandler(writeFailure)(
      new Request("https://world.test/api/hub/preferences", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          host: "world.test",
          origin: "https://world.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify(system),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "EXECUTION_PREFERENCES_UNAVAILABLE" },
    });
  });
});
