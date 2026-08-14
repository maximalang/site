import {
  NativeChatBrowserProfileConfigurationSchema,
  NativeChatBrowserProfileListSchema,
} from "@agent-world/domain";
import { describe, expect, it, vi } from "vitest";
import { configureNativeChatProfile, loadNativeChatProfiles } from "./native-chat-profile-api";

const profile = NativeChatBrowserProfileConfigurationSchema.parse({
  schemaVersion: 1,
  accountId: "account_11111111-1111-1111-1111-111111111111",
  profileRef: "plus-primary",
  launchUrl: "https://chatgpt.com/g/ai-world-agent",
  isEnabled: true,
  updatedAt: "2026-08-14T10:00:00.000Z",
});

describe("Native Chat profile client", () => {
  it("loads and validates the no-store owner projection", async () => {
    const list = NativeChatBrowserProfileListSchema.parse({
      schemaVersion: 1,
      profiles: [profile],
    });
    const fetcher = vi.fn(async () => Response.json(list));
    await expect(loadNativeChatProfiles(fetcher)).resolves.toEqual(list);
    expect(fetcher).toHaveBeenCalledWith("/api/hub/native-chat-profiles", { cache: "no-store" });
  });

  it("writes a strict configuration with CSRF and validates the response", async () => {
    const fetcher = vi.fn(async () => Response.json(profile));
    await expect(
      configureNativeChatProfile(
        {
          schemaVersion: 1,
          accountId: profile.accountId,
          profileRef: profile.profileRef,
          launchUrl: profile.launchUrl,
          isEnabled: true,
        },
        "csrf-value",
        fetcher,
      ),
    ).resolves.toEqual(profile);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/hub/native-chat-profiles",
      expect.objectContaining({ method: "PUT", cache: "no-store" }),
    );
  });
});
