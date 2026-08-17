// @vitest-environment jsdom

import type { MemoryNetwork } from "@agent-world/domain";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryNetworkGraph } from "./memory-network-graph";

const sourceId = "context_item_11111111-1111-1111-1111-111111111111";
const firstId = "context_item_22222222-2222-2222-2222-222222222222";
const secondId = "context_item_33333333-3333-3333-3333-333333333333";

const network = {
  schemaVersion: 1,
  projectId: "project_11111111-1111-1111-1111-111111111111",
  nodes: [
    {
      contextItemId: firstId,
      sourceContextItemId: sourceId,
      content: "PostgreSQL remains canonical.",
      importance: 0.95,
      createdAt: "2026-08-15T10:00:00.000Z",
    },
    {
      contextItemId: secondId,
      sourceContextItemId: firstId,
      content: "World and Command share one read model.",
      importance: 0.8,
      createdAt: "2026-08-15T10:05:00.000Z",
    },
  ],
  edges: [
    {
      decisionId: "memory_decision_11111111-1111-1111-1111-111111111111",
      sourceContextItemId: sourceId,
      targetContextItemId: firstId,
      relation: "ACCEPTED_FROM",
      createdAt: "2026-08-15T10:00:00.000Z",
    },
    {
      decisionId: "memory_decision_22222222-2222-2222-2222-222222222222",
      sourceContextItemId: firstId,
      targetContextItemId: secondId,
      relation: "MERGED_INTO",
      createdAt: "2026-08-15T10:05:00.000Z",
    },
  ],
} as MemoryNetwork;

afterEach(cleanup);

describe("MemoryNetworkGraph", () => {
  it("renders only canonical nodes and provenance endpoints with real directed edges", () => {
    const { container } = render(<MemoryNetworkGraph advanced={false} network={network} />);

    expect(
      screen.getByRole("img", {
        name: "Memory Network: 2 canonical memories, 2 provenance links",
      }),
    ).toBeTruthy();
    expect(container.querySelectorAll("[data-memory-kind='memory']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-memory-kind='reference']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-relation='ACCEPTED_FROM']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-relation='MERGED_INTO']")).toHaveLength(1);
    expect(screen.getByText("Memory: PostgreSQL remains canonical.")).toBeTruthy();
  });

  it("wraps long visual labels into bounded lines without truncating semantic memory", () => {
    render(<MemoryNetworkGraph advanced={false} network={network} />);

    expect(screen.getByText("PostgreSQL remains")).toBeTruthy();
    expect(screen.getByText("canonical.")).toBeTruthy();
    expect(screen.getByText("Memory: PostgreSQL remains canonical.")).toBeTruthy();
  });

  it("shows full canonical and provenance identifiers only in Advanced details", () => {
    const { rerender } = render(<MemoryNetworkGraph advanced={false} network={network} />);
    expect(screen.queryByRole("heading", { name: "Canonical nodes" })).toBeNull();

    rerender(<MemoryNetworkGraph advanced network={network} />);
    expect(screen.getByRole("heading", { name: "Canonical nodes" })).toBeTruthy();
    const provenanceHeading = screen.getByRole("heading", { name: "Provenance edges" });
    const provenanceSection = provenanceHeading.closest("section");
    expect(provenanceSection).not.toBeNull();
    if (!provenanceSection) return;
    expect(screen.getAllByText(firstId).length).toBeGreaterThan(0);
    expect(within(provenanceSection).getByText("Merged into")).toBeTruthy();
  });
});
