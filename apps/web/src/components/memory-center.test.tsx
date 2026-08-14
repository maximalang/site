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
    render(
      <MemoryCenter
        client={{ load: load as never, decide }}
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
});
