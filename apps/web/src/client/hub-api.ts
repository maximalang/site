import { type HubReadModel, HubReadModelSchema } from "@agent-world/read-model";

type FetchHubReadModel = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadHubReadModel(
  fetcher: FetchHubReadModel = fetch,
  signal?: AbortSignal,
): Promise<HubReadModel> {
  const response = await fetcher("/api/hub", {
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("Hub read model is unavailable");
  const parsed = HubReadModelSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid Hub read model");
  return parsed.data;
}
