import type { Mission } from "@agent-world/domain";

export async function createMission(input: Mission, csrfToken: string): Promise<void> {
  const response = await fetch("/api/missions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Mission command rejected");
}
