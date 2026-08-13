import {
  ExecutionPreferenceLayerSchema,
  ExecutionPreferenceReadModelSchema,
  resolveExecutionPreferences,
} from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import { loadExecutionPreferences, writeExecutionPreferences } from "./execution-preference-api";

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
const model = ExecutionPreferenceReadModelSchema.parse({
  schemaVersion: 1,
  selection: {},
  local: system,
  resolved: resolveExecutionPreferences([system]),
});

describe("execution preference API client", () => {
  it("encodes a bounded selection and validates the read response", async () => {
    const fetcher = vi.fn(async () => Response.json(model));
    await expect(loadExecutionPreferences({}, fetcher)).resolves.toEqual(model);
    expect(fetcher).toHaveBeenCalledWith("/api/hub/preferences", {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });
  });

  it("writes a strict sparse layer with CSRF protection", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await writeExecutionPreferences({ layer: system, csrfToken: "csrf-token" }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/hub/preferences",
      expect.objectContaining({
        body: JSON.stringify(system),
        method: "PUT",
        headers: expect.objectContaining({ "X-Agent-World-CSRF": "csrf-token" }),
      }),
    );
  });

  it("rejects malformed responses without reflecting their content", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...model, secret: "do-not-reflect" }));
    await expect(loadExecutionPreferences({}, fetcher)).rejects.toThrow(
      "Invalid execution preference response",
    );
  });
});
