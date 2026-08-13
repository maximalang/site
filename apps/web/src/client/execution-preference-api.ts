import {
  type ExecutionPreferenceLayer,
  type ExecutionPreferenceReadModel,
  ExecutionPreferenceReadModelSchema,
  type ExecutionPreferenceSelection,
  ExecutionPreferenceSelectionSchema,
} from "@agent-world/read-model";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function endpoint(input: ExecutionPreferenceSelection): string {
  const value = ExecutionPreferenceSelectionSchema.parse(input);
  const parameters = new URLSearchParams();
  if (value.projectId) parameters.set("projectId", value.projectId);
  if (value.agentId) parameters.set("agentId", value.agentId);
  if (value.taskId) parameters.set("taskId", value.taskId);
  const query = parameters.toString();
  return `/api/hub/preferences${query ? `?${query}` : ""}`;
}

export async function loadExecutionPreferences(
  selection: ExecutionPreferenceSelection,
  fetcher: Fetcher = fetch,
): Promise<ExecutionPreferenceReadModel> {
  const response = await fetcher(endpoint(selection), {
    cache: "no-store",
    credentials: "same-origin",
    method: "GET",
  });
  if (!response.ok) throw new Error("Execution preferences are unavailable");
  const parsed = ExecutionPreferenceReadModelSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Invalid execution preference response");
  return parsed.data;
}

export async function writeExecutionPreferences(
  input: { layer: ExecutionPreferenceLayer; csrfToken: string },
  fetcher: Fetcher = fetch,
): Promise<void> {
  const response = await fetcher("/api/hub/preferences", {
    body: JSON.stringify(input.layer),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-World-CSRF": input.csrfToken,
    },
    method: "PUT",
  });
  if (!response.ok) throw new Error("Execution preference update failed");
}
