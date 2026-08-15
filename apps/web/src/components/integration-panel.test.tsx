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
});
