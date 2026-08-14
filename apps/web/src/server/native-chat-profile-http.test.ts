import {
  NativeChatBrowserProfileConfigurationSchema,
  NativeChatBrowserProfileListSchema,
} from "@agent-world/domain";
import { NativeChatLaunchStoreError } from "@agent-world/postgres-store";
import { describe, expect, it, vi } from "vitest";
import { createNativeChatProfileRouteHandler } from "./native-chat-profile-http";

const profile = NativeChatBrowserProfileConfigurationSchema.parse({
  schemaVersion: 1 as const,
  accountId: "account_11111111-1111-1111-1111-111111111111",
  profileRef: "plus-primary",
  launchUrl: "https://chatgpt.com/g/ai-world-agent",
  isEnabled: true,
  updatedAt: "2026-08-14T10:00:00.000Z",
});
const profileList = NativeChatBrowserProfileListSchema.parse({
  schemaVersion: 1,
  profiles: [profile],
});

describe("Native Chat profile owner HTTP boundary", () => {
  it("returns a bounded no-store owner projection", async () => {
    const response = await createNativeChatProfileRouteHandler({
      authorize: vi.fn(async () => true),
      list: vi.fn(async () => profileList),
      configure: vi.fn(),
    })(new Request("https://agent-world.example.com/api/hub/native-chat-profiles"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual(profileList);
  });

  it("validates and persists one same-origin owner configuration", async () => {
    const configure = vi.fn(async () => profile);
    const response = await createNativeChatProfileRouteHandler({
      authorize: vi.fn(async () => true),
      list: vi.fn(),
      configure,
      now: () => new Date(profile.updatedAt),
    })(
      new Request("https://agent-world.example.com/api/hub/native-chat-profiles", {
        method: "PUT",
        headers: { "content-type": "application/json", origin: "https://agent-world.example.com" },
        body: JSON.stringify({
          schemaVersion: 1,
          accountId: profile.accountId,
          profileRef: profile.profileRef,
          launchUrl: profile.launchUrl,
          isEnabled: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(configure).toHaveBeenCalledWith({ ...profile });
    expect(await response.json()).toEqual(profile);
  });

  it("rejects unauthorized, cross-origin and query-bearing App URLs", async () => {
    const handler = createNativeChatProfileRouteHandler({
      authorize: vi.fn(async (request) => request.headers.get("authorization") === "owner"),
      list: vi.fn(),
      configure: vi.fn(),
    });
    const anonymous = await handler(
      new Request("https://agent-world.example.com/api/hub/native-chat-profiles"),
    );
    const hostile = await handler(
      new Request("https://agent-world.example.com/api/hub/native-chat-profiles", {
        method: "PUT",
        headers: {
          authorization: "owner",
          "content-type": "application/json",
          origin: "https://attacker.example",
        },
        body: "{}",
      }),
    );
    const secretUrl = await handler(
      new Request("https://agent-world.example.com/api/hub/native-chat-profiles", {
        method: "PUT",
        headers: {
          authorization: "owner",
          "content-type": "application/json",
          origin: "https://agent-world.example.com",
        },
        body: JSON.stringify({ ...profile, launchUrl: `${profile.launchUrl}?token=secret` }),
      }),
    );

    expect(anonymous.status).toBe(401);
    expect(hostile.status).toBe(400);
    expect(secretUrl.status).toBe(400);
  });

  it("maps invalid Account references without exposing database details", async () => {
    const response = await createNativeChatProfileRouteHandler({
      authorize: vi.fn(async () => true),
      list: vi.fn(),
      configure: vi.fn(async () => {
        throw new NativeChatLaunchStoreError("INVALID_ACCOUNT");
      }),
    })(
      new Request("https://agent-world.example.com/api/hub/native-chat-profiles", {
        method: "PUT",
        headers: { "content-type": "application/json", origin: "https://agent-world.example.com" },
        body: JSON.stringify({
          schemaVersion: 1,
          accountId: profile.accountId,
          profileRef: profile.profileRef,
          launchUrl: profile.launchUrl,
          isEnabled: true,
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "INVALID_ACCOUNT" } });
  });
});
