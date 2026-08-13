import { type WorldReadModel, WorldReadModelSchema } from "@agent-world/read-model";

type FetchWorldReadModel = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadWorldReadModel(
  fetcher: FetchWorldReadModel = fetch,
  signal?: AbortSignal,
): Promise<WorldReadModel> {
  const response = await fetcher("/api/world", {
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error("World read model is unavailable");
  }
  const parsed = WorldReadModelSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Invalid world read model");
  }
  return parsed.data;
}
