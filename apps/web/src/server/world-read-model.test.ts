import { describe, expect, it } from "vitest";
import { createWorldReadModelProvider } from "./world-read-model";

describe("createWorldReadModelProvider", () => {
  it("fails closed by default", async () => {
    const read = createWorldReadModelProvider({
      dataSource: undefined,
      environment: "development",
      now: () => new Date("2026-08-13T06:00:00.000Z"),
    });

    await expect(read()).resolves.toEqual(
      expect.objectContaining({ source: "UNAVAILABLE", agents: [], tasks: [] }),
    );
  });

  it("serves a visibly labelled contract fixture only outside production", async () => {
    const development = createWorldReadModelProvider({
      dataSource: "contract-fixture",
      environment: "development",
      now: () => new Date("2026-08-13T06:00:00.000Z"),
    });
    const production = createWorldReadModelProvider({
      dataSource: "contract-fixture",
      environment: "production",
      now: () => new Date("2026-08-13T06:00:00.000Z"),
    });

    await expect(development()).resolves.toEqual(
      expect.objectContaining({ source: "CONTRACT_FIXTURE" }),
    );
    await expect(production()).resolves.toEqual(
      expect.objectContaining({ source: "UNAVAILABLE", agents: [] }),
    );
  });
});
