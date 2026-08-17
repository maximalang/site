import {
  type IntegrationAction,
  IntegrationActionResultSchema,
  type IntegrationCreate,
  type IntegrationMutation,
  IntegrationMutationReceiptSchema,
  IntegrationRegistrySchema,
  type IntegrationSshOperationCreate,
  type IntegrationToolAllowlistCreate,
} from "@agent-world/read-model";

type WithoutCreatedAt<T> = T extends unknown ? Omit<T, "createdAt"> : never;

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
  async registerTool(input: Omit<IntegrationToolAllowlistCreate, "createdAt">, csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({ operation: "REGISTER_TOOL", ...input }),
    });
    if (!response.ok) throw new Error("Integration tool registration rejected");
  },
  async registerSshOperation(
    input: WithoutCreatedAt<IntegrationSshOperationCreate>,
    csrfToken: string,
  ) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({ operation: "REGISTER_SSH_OPERATION", ...input }),
    });
    if (!response.ok) throw new Error("SSH operation registration rejected");
  },
  async requestMutation(integrationId: string, mutation: IntegrationMutation, csrfToken: string) {
    const uuid = crypto.randomUUID();
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({
        operation: "REQUEST_MUTATION",
        requestId: `integration_mutation_${uuid}`,
        integrationId,
        mutation,
        commandId: `integration:mutation:request:${uuid}`,
      }),
    });
    if (!response.ok) throw new Error("Integration mutation rejected");
    const body = (await response.json()) as { result?: unknown };
    return IntegrationMutationReceiptSchema.parse(body.result);
  },
  async decideMutation(requestId: string, decision: "APPROVE" | "DENY", csrfToken: string) {
    const response = await fetch("/api/integrations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-agent-world-csrf": csrfToken },
      body: JSON.stringify({
        operation: "DECIDE_MUTATION",
        requestId,
        decision,
        commandId: `integration:mutation:${decision.toLowerCase()}:${crypto.randomUUID()}`,
      }),
    });
    if (!response.ok) throw new Error("Integration mutation decision rejected");
    const body = (await response.json()) as { result?: unknown };
    return IntegrationMutationReceiptSchema.parse(body.result);
  },
};
