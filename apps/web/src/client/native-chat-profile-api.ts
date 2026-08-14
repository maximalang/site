import {
  type NativeChatBrowserProfileConfiguration,
  type NativeChatBrowserProfileConfigurationInput,
  NativeChatBrowserProfileConfigurationSchema,
  type NativeChatBrowserProfileList,
  NativeChatBrowserProfileListSchema,
} from "@agent-world/domain";

type FetchNativeChatProfiles = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadNativeChatProfiles(
  fetcher: FetchNativeChatProfiles = fetch,
): Promise<NativeChatBrowserProfileList> {
  const response = await fetcher("/api/hub/native-chat-profiles", { cache: "no-store" });
  if (!response.ok) throw new Error("Native Chat profiles are unavailable");
  const parsed = NativeChatBrowserProfileListSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid Native Chat profile list");
  return parsed.data;
}

export async function configureNativeChatProfile(
  input: NativeChatBrowserProfileConfigurationInput,
  csrfToken: string,
  fetcher: FetchNativeChatProfiles = fetch,
): Promise<NativeChatBrowserProfileConfiguration> {
  const response = await fetcher("/api/hub/native-chat-profiles", {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-agent-world-csrf": csrfToken,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Native Chat profile was not saved");
  const parsed = NativeChatBrowserProfileConfigurationSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid Native Chat profile response");
  return parsed.data;
}
