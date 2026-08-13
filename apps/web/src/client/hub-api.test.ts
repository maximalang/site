import { HubReadModelSchema } from "@agent-world/read-model";
import { describe, expect, it, vi } from "vitest";
import { loadHubReadModel } from "./hub-api";

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

describe("loadHubReadModel", () => {
  it("loads the owner-only no-store Hub endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json(fixture));
    await expect(loadHubReadModel(fetcher)).resolves.toEqual(fixture);
    expect(fetcher).toHaveBeenCalledWith("/api/hub", {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });
  });

  it("rejects malformed and private-field-bearing responses", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ...fixture, credentialRef: "vault:private" }),
    );
    await expect(loadHubReadModel(fetcher)).rejects.toThrow("Invalid Hub read model");
    await expect(loadHubReadModel(fetcher)).rejects.not.toThrow("vault:private");
  });
});
