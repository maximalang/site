import { describe, expect, it, vi } from "vitest";
import { createLivenessHandler, createReadinessHandler } from "./health-http";

describe("health HTTP contracts", () => {
  it("reports process liveness without probing dependencies", async () => {
    const response = await createLivenessHandler()();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "alive" });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("reports readiness only after the authoritative runtime probe succeeds", async () => {
    const probe = vi.fn(async () => undefined);
    const response = await createReadinessHandler(probe)();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(probe).toHaveBeenCalledOnce();
  });

  it("fails readiness closed without leaking dependency errors", async () => {
    const response = await createReadinessHandler(async () => {
      throw new Error("postgresql://owner:secret@database/agent_world");
    })();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
