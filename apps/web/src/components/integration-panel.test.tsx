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
      registerTool: vi.fn(),
      registerSshOperation: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    await screen.findByRole("heading", { name: "Интеграции" });
    fireEvent.change(screen.getByLabelText("Тип"), { target: { value: "SSH" } });
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Timeweb VDS" } });
    fireEvent.change(screen.getByLabelText("Хост"), { target: { value: "vds.example" } });
    fireEvent.change(screen.getByLabelText("Пользователь SSH"), {
      target: { value: "agent-world" },
    });
    fireEvent.change(screen.getByLabelText("Учётные данные"), { target: { value: "private-key" } });
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
      registerTool: vi.fn(),
      registerSshOperation: vi.fn(),
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
      registerTool: vi.fn(),
      registerSshOperation: vi.fn(),
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

  it("exposes Steel inventory without a Steel write surface", async () => {
    const integrationId = "integration_22222222-2222-4222-8222-222222222222";
    const action = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      integrationId,
      action: "STEEL_LIST_SESSIONS",
      outcome: "RECORDED",
      status: "SUCCEEDED",
      items: [{ id: "session-1", label: "session-1", detail: "live" }],
      executedAt: "2026-08-15T12:00:00.000Z",
    });
    const client = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        generatedAt: "2026-08-15T12:00:00.000Z",
        integrations: [
          {
            id: integrationId,
            kind: "STEEL",
            label: "Steel browser sessions",
            endpoint: { transport: "HTTPS", url: "https://steel.example" },
            health: "READY",
            isEnabled: true,
            hasCredential: false,
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
      registerTool: vi.fn(),
      registerSshOperation: vi.fn(),
      requestMutation: vi.fn(),
      decideMutation: vi.fn(),
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    expect(await screen.findByRole("option", { name: "STEEL" })).toBeTruthy();
    expect(screen.queryByText(/запуск workflow/)).toBeNull();
    expect(screen.queryByText(/разрешённые инструменты записи/)).toBeNull();
    expect(screen.queryByText(/разрешённые серверные операции/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сессии" }));
    expect(await screen.findByText(/session-1 · live/)).toBeTruthy();
    expect(action).toHaveBeenCalledWith(integrationId, "STEEL_LIST_SESSIONS", "csrf");
    expect(client.requestMutation).not.toHaveBeenCalled();
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
      registerTool: vi.fn(),
      registerSshOperation: vi.fn(),
      requestMutation,
      decideMutation,
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    fireEvent.click(await screen.findByText("Расширенное · запуск workflow"));
    fireEvent.change(screen.getByLabelText("Владелец"), { target: { value: "maximalang" } });
    fireEvent.change(screen.getByLabelText("Репозиторий"), { target: { value: "site" } });
    fireEvent.click(screen.getByRole("button", { name: "Запросить запуск" }));
    await screen.findByText("PENDING");
    expect(decideMutation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить запуск" }));
    await vi.waitFor(() => expect(decideMutation).toHaveBeenCalledOnce());
  });

  it("registers and requests only a typed SSH operation", async () => {
    const integrationId = "integration_11111111-1111-4111-8111-111111111111";
    const operationId = "integration_ssh_operation_11111111-1111-1111-1111-111111111111";
    const pending = {
      schemaVersion: 1 as const,
      requestId: "integration_mutation_11111111-1111-1111-1111-111111111111",
      integrationId,
      mutation: { kind: "SSH_RUN_REGISTERED_OPERATION" as const, sshOperationId: operationId },
      state: "PENDING" as const,
      outcome: "RECORDED" as const,
      requestedAt: "2026-08-15T12:00:00.000Z",
    };
    const registerSshOperation = vi.fn();
    const requestMutation = vi.fn().mockResolvedValue(pending);
    const client = {
      list: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        generatedAt: pending.requestedAt,
        integrations: [
          {
            id: integrationId,
            kind: "SSH",
            label: "Timeweb VDS",
            endpoint: { transport: "SSH", host: "vds.example", port: 22, username: "deploy" },
            health: "READY",
            isEnabled: true,
            hasCredential: true,
            createdAt: pending.requestedAt,
            updatedAt: pending.requestedAt,
          },
        ],
        sshOperations: [
          {
            id: operationId,
            integrationId,
            label: "Restart Agent World",
            operationKind: "SYSTEMD_RESTART",
            systemdUnit: "agent-world.service",
            hostKeySha256: `SHA256:${"A".repeat(43)}`,
            isEnabled: true,
            createdAt: pending.requestedAt,
          },
        ],
      }),
      create: vi.fn(),
      credential: vi.fn(),
      lifecycle: vi.fn(),
      probe: vi.fn(),
      action: vi.fn(),
      registerTool: vi.fn(),
      registerSshOperation,
      requestMutation,
      decideMutation: vi.fn(),
    };
    render(<IntegrationPanel client={client} csrfToken="csrf" />);
    fireEvent.click(await screen.findByText("Расширенное · разрешённые серверные операции"));
    fireEvent.change(screen.getByLabelText("Название операции"), {
      target: { value: "Restart Agent World" },
    });
    fireEvent.change(screen.getByLabelText("Юнит systemd"), {
      target: { value: "agent-world.service" },
    });
    fireEvent.change(screen.getByLabelText("Ключ хоста SHA-256"), {
      target: { value: `SHA256:${"A".repeat(43)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Зарегистрировать операцию" }));
    await vi.waitFor(() => expect(registerSshOperation).toHaveBeenCalledOnce());
    expect(registerSshOperation.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        operationKind: "SYSTEMD_RESTART",
        systemdUnit: "agent-world.service",
      }),
    );
    const requestButton = screen.getByRole("button", { name: "Запросить выполнение" });
    await vi.waitFor(() => expect((requestButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(requestButton);
    await vi.waitFor(() =>
      expect(requestMutation).toHaveBeenCalledWith(
        integrationId,
        { kind: "SSH_RUN_REGISTERED_OPERATION", sshOperationId: operationId },
        "csrf",
      ),
    );
  });
});
