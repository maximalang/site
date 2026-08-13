import { describe, expect, it, vi } from "vitest";
import { buildContractFixture } from "../test-fixtures";
import { loadWorldReadModel } from "./world-api";

describe("loadWorldReadModel", () => {
  it("loads and validates the one canonical read-model endpoint", async () => {
    const fixture = buildContractFixture();
    const fetcher = vi.fn(async () => Response.json(fixture));

    await expect(loadWorldReadModel(fetcher)).resolves.toEqual(fixture);
    expect(fetcher).toHaveBeenCalledWith("/api/world", {
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    });
  });

  it("rejects malformed or runtime-leaking responses without reflecting the body", async () => {
    const fixture = buildContractFixture();
    const malformed = {
      ...fixture,
      agents: [{ ...fixture.agents[0], externalAgentId: "must-not-cross-api" }],
    };
    const fetcher = vi.fn(async () => Response.json(malformed));

    await expect(loadWorldReadModel(fetcher)).rejects.toThrow("Invalid world read model");
    await expect(loadWorldReadModel(fetcher)).rejects.not.toThrow("must-not-cross-api");
  });
});
