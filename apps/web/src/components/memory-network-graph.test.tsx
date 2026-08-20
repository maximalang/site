// @vitest-environment jsdom

import type { MemoryNetwork } from "@agent-world/domain";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { layoutVertices, MemoryNetworkGraph, type NetworkVertex } from "./memory-network-graph";

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

function vertices(count: number): NetworkVertex[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `vertex-${String(index).padStart(2, "0")}`,
    kind: index % 4 === 3 ? "REFERENCE" : "MEMORY",
    content: `Memory vertex ${index}`,
    importance: index % 4 === 3 ? null : 0.8,
    createdAt: `2026-08-15T10:${String(index).padStart(2, "0")}:00.000Z`,
  }));
}

afterEach(cleanup);

describe("MemoryNetworkGraph", () => {
  it("renders only canonical nodes and provenance endpoints with real directed edges", () => {
    const { container } = render(<MemoryNetworkGraph advanced={false} network={network} />);

    expect(
      screen.getByRole("img", {
        name: "Сеть памяти: канонических записей — 2, связей происхождения — 2",
      }),
    ).toBeTruthy();
    expect(container.querySelectorAll("[data-memory-kind='memory']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-memory-kind='reference']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-relation='ACCEPTED_FROM']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-relation='MERGED_INTO']")).toHaveLength(1);
    expect(screen.getByText("Память: PostgreSQL remains canonical.")).toBeTruthy();
    expect(screen.getByText("Каноническая память")).toBeTruthy();
    expect(screen.getByText("Контекст происхождения")).toBeTruthy();
    expect(screen.getByText("Принято из")).toBeTruthy();
    expect(screen.getByText("Объединено в")).toBeTruthy();
  });

  it("wraps long visual labels into bounded lines without truncating semantic memory", () => {
    render(<MemoryNetworkGraph advanced={false} network={network} />);

    expect(screen.getByText("PostgreSQL remains")).toBeTruthy();
    expect(screen.getByText("canonical.")).toBeTruthy();
    expect(screen.getByText("Память: PostgreSQL remains canonical.")).toBeTruthy();
  });

  it("uses a compact two-column layout for the three-vertex canonical fixture on narrow canvas", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 360,
    });
    try {
      const { container } = render(<MemoryNetworkGraph advanced={false} network={network} />);
      const graph = screen.getByTestId("memory-network-graph");

      await waitFor(() => expect(graph.getAttribute("width")).toBe("360"));
      const transforms = [...container.querySelectorAll("[data-memory-kind]")].map((element) =>
        element.getAttribute("transform"),
      );
      expect(transforms).toEqual(["translate(100 82)", "translate(260 82)", "translate(100 206)"]);
      expect(graph.getAttribute("height")).toBe("300");
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    }
  });

  it("keeps adaptive layout bounded and deterministic from empty through larger networks", () => {
    const empty = layoutVertices([], 320);
    const one = layoutVertices(vertices(1), 320);
    const three = layoutVertices(vertices(3), 320);
    const ten = layoutVertices(vertices(10), 320);
    const repeatedTen = layoutVertices(vertices(10), 320);

    expect(empty.width).toBeGreaterThanOrEqual(280);
    expect(empty.height).toBe(160);
    expect(empty.points).toHaveLength(0);
    expect(one.height).toBe(200);
    expect(three.height).toBe(300);
    expect(ten.height).toBeGreaterThan(three.height);
    expect(new Set(three.points.map((point) => point.x)).size).toBe(2);
    expect(repeatedTen).toEqual(ten);

    for (const layout of [one, three, ten]) {
      for (const point of layout.points) {
        expect(point.x).toBeGreaterThan(0);
        expect(point.y).toBeGreaterThan(0);
        expect(point.x).toBeLessThan(layout.width);
        expect(point.y).toBeLessThan(layout.height);
      }
    }
    expect(ten.points.map((point) => point.id)).toEqual(vertices(10).map((point) => point.id));
  });

  it("shows full canonical and provenance identifiers only in advanced details", () => {
    const { rerender } = render(<MemoryNetworkGraph advanced={false} network={network} />);
    expect(screen.queryByRole("heading", { name: "Канонические записи" })).toBeNull();

    rerender(<MemoryNetworkGraph advanced network={network} />);
    expect(screen.getByRole("heading", { name: "Канонические записи" })).toBeTruthy();
    const provenanceHeading = screen.getByRole("heading", { name: "Связи происхождения" });
    const provenanceSection = provenanceHeading.closest("section");
    expect(provenanceSection).not.toBeNull();
    if (!provenanceSection) return;
    expect(screen.getAllByText(firstId).length).toBeGreaterThan(0);
    expect(within(provenanceSection).getByText("Объединено в")).toBeTruthy();
  });
});
