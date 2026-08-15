// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntegrationPanel } from "./integration-panel";

afterEach(cleanup);
describe("IntegrationPanel", () => {
  it("creates an SSH endpoint and writes its credential separately", async () => {
    const client = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        generatedAt: "2026-08-15T12:00:00.000Z",
        integrations: [],
      }),
      create: vi.fn().mockResolvedValue(undefined),
      credential: vi.fn().mockResolvedValue(undefined),
      lifecycle: vi.fn().mockResolvedValue(undefined),
      probe: vi.fn().mockResolvedValue(undefined),
      action: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        integrationId: "integration_11111111-1111-4111-8111-111111111111",
        action: "MCP_LIST_TOOLS",
        outcome: "RECORDED",
        status: "SUCCEEDED",
        items: [],
        executedAt: "2026-08-15T12:00:00.000Z",
      }),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    await screen.findByRole("heading", { name: "Интеграции" });
    fireEvent.change(screen.getByLabelText("Тип"), { target: { value: "SSH" } });
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Timeweb VDS" } });
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "vds.example" } });
    fireEvent.change(screen.getByLabelText("SSH user"), { target: { value: "agent-world" } });
    fireEvent.change(screen.getByLabelText("Credential"), { target: { value: "private-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    await vi.waitFor(() => expect(client.create).toHaveBeenCalled());
    expect(client.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        kind: "SSH",
        endpoint: expect.objectContaining({ transport: "SSH" }),
      }),
    );
    expect(client.credential).toHaveBeenCalledWith(
      expect.stringMatching(/^integration_/),
      "private-key",
      "csrf",
    );
  });

  it("runs an explicit protocol probe for an enabled Integration", async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const client = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        generatedAt: "2026-08-15T12:00:00.000Z",
        integrations: [
          {
            id: "integration_11111111-1111-4111-8111-111111111111",
            kind: "MCP",
            label: "AI World MCP",
            endpoint: { transport: "HTTPS", url: "https://world.example/api/mcp" },
            health: "UNCONFIGURED",
            isEnabled: true,
            hasCredential: true,
            createdAt: "2026-08-15T12:00:00.000Z",
            updatedAt: "2026-08-15T12:00:00.000Z",
          },
        ],
      }),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe,
      action: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    fireEvent.click(await screen.findByRole("button", { name: "Проверить" }));
    await vi.waitFor(() =>
      expect(probe).toHaveBeenCalledWith(expect.stringMatching(/^integration_/), "csrf"),
    );
  });

  it("runs the predefined action for a ready Integration and renders bounded evidence", async () => {
    const action = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      integrationId: "integration_11111111-1111-4111-8111-111111111111",
      action: "MCP_LIST_TOOLS",
      outcome: "RECORDED",
      status: "SUCCEEDED",
      items: [{ id: "search", label: "Search", detail: "Public-source search" }],
      executedAt: "2026-08-15T12:00:00.000Z",
    });
    const client = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        generatedAt: "2026-08-15T12:00:00.000Z",
        integrations: [
          {
            id: "integration_11111111-1111-4111-8111-111111111111",
            kind: "MCP",
            label: "AI World MCP",
            endpoint: { transport: "HTTPS", url: "https://world.example/api/mcp" },
            health: "READY",
            isEnabled: true,
            hasCredential: true,
            createdAt: "2026-08-15T12:00:00.000Z",
            updatedAt: "2026-08-15T12:00:00.000Z",
          },
        ],
      }),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action,
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    fireEvent.click(await screen.findByRole("button", { name: "Инструменты" }));
    expect(await screen.findByText(/Public-source search/)).toBeTruthy();
    expect(action).toHaveBeenCalledWith(
      "integration_11111111-1111-4111-8111-111111111111",
      "MCP_LIST_TOOLS",
      "csrf",
    );
  });

  it("requires a separate owner confirmation before GitHub workflow dispatch", async () => {
    const pending = {
      schemaVersion: 1 as const,
      requestId: "integration_mutation_11111111-1111-1111-1111-111111111111",
      integrationId: "integration_11111111-1111-4111-8111-111111111111",
      mutation: {
        kind: "GITHUB_DISPATCH_WORKFLOW" as const,
        owner: "maximalang",
        repository: "site",
        workflowId: "deploy.yml",
        ref: "main",
      },
      state: "PENDING" as const,
      outcome: "RECORDED" as const,
      requestedAt: "2026-08-15T12:00:00.000Z",
    };
    const requestMutation = vi.fn().mockResolvedValue(pending);
    const decideMutation = vi.fn().mockResolvedValue({
      ...pending,
      state: "SUCCEEDED",
      decidedAt: pending.requestedAt,
      completedAt: pending.requestedAt,
    });
    const client = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        generatedAt: pending.requestedAt,
        integrations: [
          {
            id: pending.integrationId,
            kind: "GITHUB",
            label: "GitHub",
            endpoint: { transport: "HTTPS", url: "https://api.github.com" },
            health: "READY",
            isEnabled: true,
            hasCredential: true,
            createdAt: pending.requestedAt,
            updatedAt: pending.requestedAt,
          },
        ],
      }),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action: vi.fn(),
      requestMutation,
      decideMutation,
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    fireEvent.click(await screen.findByText("Advanced · workflow dispatch"));
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "maximalang" } });
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "site" } });
    fireEvent.click(screen.getByRole("button", { name: "Запросить запуск" }));
    await screen.findByText("PENDING");
    expect(decideMutation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить запуск" }));
    await vi.waitFor(() => expect(decideMutation).toHaveBeenCalledOnce());
  });
});
