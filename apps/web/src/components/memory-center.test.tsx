// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryCenter } from "./memory-center";

const project = {
  projectId: "project_11111111-1111-1111-1111-111111111111",
  slug: "world",
  name: "AI World",
  isArchived: false,
  createdAt: "2026-08-15T00:00:00.000Z",
  agentIds: [],
};

describe("MemoryCenter", () => {
  it("opens an accessible modal and commits an Inbox decision", async () => {
    const user = userEvent.setup();
    const load = vi.fn(async () => ({
      schemaVersion: 1 as const,
      projectId: project.projectId,
      proposals: [
        {
          schemaVersion: 1 as const,
          id: "memory_proposal_22222222-2222-2222-2222-222222222222",
          projectId: project.projectId,
          sourceContextItemId: "context_item_33333333-3333-3333-3333-333333333333",
          content: "PostgreSQL remains canonical.",
          contentHash: "a".repeat(64),
          estimatedTokens: 5,
          importance: 0.9,
          status: "PENDING" as const,
          createdAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    }));
    const decide = vi.fn(async () => ({ outcome: "CREATED" }));
    const ingest = vi.fn();
    render(
      <MemoryCenter
        client={{ load: load as never, decide, ingest }}
        csrfToken="csrf"
        projects={[project] as never}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Открыть Memory Center" }));
    const dialog = screen.getByRole("dialog", { name: /Memory Center · AI World/ });
    expect(await within(dialog).findByText("PostgreSQL remains canonical.")).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ action: "ACCEPT" }), "csrf");
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("indexes a source into project-scoped shared RAG with Auto MIME", async () => {
    const user = userEvent.setup();
    const ingest = vi.fn(async () => ({ outcome: "CREATED" }));
    render(
      <MemoryCenter
        client={{ load: vi.fn() as never, decide: vi.fn(), ingest }}
        csrfToken="csrf"
        projects={[project] as never}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Добавить RAG источник" }));
    await user.type(screen.getByLabelText("Название"), "Architecture");
    await user.type(screen.getByLabelText("Источник / имя файла"), "architecture.md");
    await user.type(
      screen.getByLabelText("Текст для общей базы знаний"),
      "PostgreSQL is canonical.",
    );
    await user.click(screen.getByRole("button", { name: "Индексировать" }));
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.projectId,
        mimeType: "text/markdown",
        source: expect.objectContaining({ kind: "UPLOAD", ref: "architecture.md" }),
      }),
      "csrf",
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Источник добавлен");
  });
});
