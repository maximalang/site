import { describe, expect, it, vi } from "vitest";
import type { TransactionPool } from "./conversation-store.js";
import { PostgresIntegrationStore } from "./integration-store.js";

function pool(rows: unknown[][]) {
  const query = vi.fn();
  for (const value of rows) query.mockResolvedValueOnce({ rows: value });
  const release = vi.fn();
  return {
    query,
    release,
    value: { connect: vi.fn(async () => ({ query, release })) } as unknown as TransactionPool,
  };
}
const input = {
  id: "integration_11111111-1111-4111-8111-111111111111",
  commandId: "integration:create:1",
  kind: "MCP" as const,
  label: "AI World MCP",
  endpoint: { transport: "HTTPS" as const, url: "https://world.example/api/mcp" },
  createdAt: "2026-08-15T12:00:00.000Z",
};

describe("PostgresIntegrationStore", () => {
  it("creates an idempotent credential-free integration command", async () => {
    const fake = pool([[], [], [], [], [], []]);
    await expect(new PostgresIntegrationStore(fake.value).create(input)).resolves.toEqual({
      outcome: "CREATED",
      integrationId: input.id,
    });
    expect(fake.query.mock.calls.map(([sql]) => String(sql)).join("\n")).not.toMatch(
      /plaintext|password|private_key/,
    );
    expect(fake.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("lists only safe endpoint summaries", async () => {
    const fake = pool([
      [
        {
          id: input.id,
          kind: "MCP",
          label: input.label,
          transport: "HTTPS",
          endpoint_url: input.endpoint.url,
          ssh_host: null,
          ssh_port: null,
          ssh_username: null,
          credential_ref: "secret-store:integrations/hidden",
          health: "READY",
          is_enabled: true,
          created_at: input.createdAt,
          updated_at: input.createdAt,
        },
      ],
    ]);
    const registry = await new PostgresIntegrationStore(
      fake.value,
      () => new Date(input.createdAt),
    ).list();
    expect(registry.integrations[0]).toEqual(expect.objectContaining({ hasCredential: true }));
    expect(JSON.stringify(registry)).not.toContain("secret-store:");
  });
});
