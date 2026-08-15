import {
  type IntegrationAction,
  IntegrationActionResultSchema,
  type IntegrationCreate,
  IntegrationRegistrySchema,
} from "@agent-world/read-model";

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
  async probe(integrationId: string, csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({
        operation: "TEST",
        integrationId,
        commandId: `integration:test:${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) throw new Error("Integration probe rejected");
  },
  async action(integrationId: string, action: IntegrationAction, csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({
        operation: "ACTION",
        integrationId,
        action,
        commandId: `integration:action:${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) throw new Error("Integration action rejected");
    const body = (await response.json()) as { result?: unknown };
    return IntegrationActionResultSchema.parse(body.result);
  },
};
