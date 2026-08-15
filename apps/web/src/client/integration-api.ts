import { type IntegrationCreate, IntegrationRegistrySchema } from "@agent-world/read-model";

export const integrationClient = {
  async list() {
    const response = await fetch("/api/integrations", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Integration registry unavailable");
    return IntegrationRegistrySchema.parse(await response.json());
  },
  async create(input: IntegrationCreate, csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Integration command rejected");
  },
  async credential(integrationId: string, plaintext: string, csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({
        operation: "CREDENTIAL",
        integrationId,
        commandId: `integration:credential:${crypto.randomUUID()}`,
        plaintext,
      }),
    });
    if (!response.ok) throw new Error("Credential rejected");
  },
  async lifecycle(integrationId: string, operation: "ENABLE" | "DISABLE", csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({
        operation,
        integrationId,
        commandId: `integration:${operation.toLowerCase()}:${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) throw new Error("Integration lifecycle rejected");
  },
};
