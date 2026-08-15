import { type HubCommandRequest, HubCommandResponseSchema } from "@agent-world/read-model";

export async function executeHubCommand(command: HubCommandRequest, csrfToken: string) {
  const response = await fetch("/api/hub/commands", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error("Hub command rejected");
  return HubCommandResponseSchema.parse(await response.json());
}
