import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpNativeChatLaunchStore, parseNativeChatLauncherControlUrl } from "./http-store.js";

const launcherId = "launcher_11111111-1111-4111-8111-111111111111";
const dispatchId = "chat_dispatch_22222222-2222-4222-8222-222222222222";
const accountId = "account_33333333-3333-4333-8333-333333333333";
const runId = "run_44444444-4444-4444-8444-444444444444";
const token = "a".repeat(43);

afterEach(() => vi.unstubAllGlobals());

describe("HttpNativeChatLaunchStore", () => {
  it("accepts only the exact HTTPS control endpoint, with loopback HTTP for local development", () => {
    expect(
      parseNativeChatLauncherControlUrl("https://world.example.com/api/native-chat-launcher"),
    ).toBe("https://world.example.com/api/native-chat-launcher");
    expect(
      parseNativeChatLauncherControlUrl("http://127.0.0.1:3000/api/native-chat-launcher"),
    ).toBe("http://127.0.0.1:3000/api/native-chat-launcher");
    expect(() =>
      parseNativeChatLauncherControlUrl("http://world.example.com/api/native-chat-launcher"),
    ).toThrow();
    expect(() => parseNativeChatLauncherControlUrl("https://world.example.com/api/hub")).toThrow();
  });

  it("claims through the scoped HTTP API without sending PostgreSQL or client timestamps", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({ schemaVersion: 1, action: "CLAIM", leaseMs: 120_000 });
      expect(init?.headers).toEqual(expect.objectContaining({ Authorization: `Bearer ${token}` }));
      return Response.json({
        schemaVersion: 1,
        claim: {
          schemaVersion: 1,
          dispatchId,
          message: { runId },
          accountId,
          profileRef: "plus-primary",
          launchUrl: "https://chatgpt.com/g/ai-world",
          launcherId,
          attempt: 1,
          leaseExpiresAt: "2026-08-17T19:02:00.000Z",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const store = new HttpNativeChatLaunchStore({
      controlUrl: "https://world.example.com/api/native-chat-launcher",
      token,
    });
    const claim = await store.claimNext({
      launcherId,
      claimedAt: "2026-08-17T19:00:00.000Z",
      leaseExpiresAt: "2026-08-17T19:02:00.000Z",
    });
    expect(claim?.dispatchId).toBe(dispatchId);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a claim or receipt bound to another launcher", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          schemaVersion: 1,
          claim: {
            schemaVersion: 1,
            dispatchId,
            message: { runId },
            accountId,
            profileRef: "plus-primary",
            launchUrl: "https://chatgpt.com/g/ai-world",
            launcherId: "launcher_99999999-9999-4999-8999-999999999999",
            attempt: 1,
            leaseExpiresAt: "2026-08-17T19:02:00.000Z",
          },
        }),
      ),
    );
    const store = new HttpNativeChatLaunchStore({
      controlUrl: "https://world.example.com/api/native-chat-launcher",
      token,
    });
    await expect(
      store.claimNext({
        launcherId,
        claimedAt: "2026-08-17T19:00:00.000Z",
        leaseExpiresAt: "2026-08-17T19:02:00.000Z",
      }),
    ).rejects.toThrow("different launcher");
  });
});
