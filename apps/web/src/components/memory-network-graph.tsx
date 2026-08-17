import type { MemoryNetwork } from "@agent-world/domain";
import { useId } from "react";
import styles from "./memory-network-graph.module.css";

type NetworkVertex = {
  id: string;
  kind: "MEMORY" | "REFERENCE";
  content: string;
  importance: number | null;
  createdAt: string | null;
};

type NetworkPoint = NetworkVertex & {
  x: number;
  y: number;
};

const CELL_WIDTH = 180;
const CELL_HEIGHT = 124;
const CANVAS_PADDING = 64;

function compactLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= 26 ? normalized : `${normalized.slice(0, 25)}…`;
}

function referenceLabel(id: string): string {
  return `Context ref …${id.slice(-8)}`;
}

function edgeKey(edge: MemoryNetwork["edges"][number]): string {
  return `${edge.decisionId}:${edge.relation}:${edge.sourceContextItemId}:${edge.targetContextItemId}:${edge.createdAt}`;
}

function buildVertices(network: MemoryNetwork): NetworkVertex[] {
  const nodeById = new Map<string, MemoryNetwork["nodes"][number]>(
    network.nodes.map((node) => [node.contextItemId, node]),
  );
  const ids = new Set<string>(network.nodes.map((node) => node.contextItemId));
  for (const edge of network.edges) {
    ids.add(edge.sourceContextItemId);
    ids.add(edge.targetContextItemId);
  }

  return [...ids]
    .map((id): NetworkVertex => {
      const node = nodeById.get(id);
      return node
        ? {
            id,
            kind: "MEMORY",
            content: node.content,
            importance: node.importance,
            createdAt: node.createdAt,
          }
        : {
            id,
            kind: "REFERENCE",
            content: referenceLabel(id),
            importance: null,
            createdAt: null,
          };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "MEMORY" ? -1 : 1;
      const byTime = (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
      return byTime || left.id.localeCompare(right.id);
    });
}

function layoutVertices(vertices: NetworkVertex[]): {
  points: NetworkPoint[];
  width: number;
  height: number;
} {
  if (vertices.length === 0) return { points: [], width: 640, height: 280 };
  const columns = Math.max(1, Math.ceil(Math.sqrt(vertices.length * 1.35)));
  const rows = Math.ceil(vertices.length / columns);
  const width = Math.max(640, CANVAS_PADDING * 2 + columns * CELL_WIDTH);
  const height = Math.max(280, CANVAS_PADDING * 2 + rows * CELL_HEIGHT);
  return {
    width,
    height,
    points: vertices.map((vertex, index) => ({
      ...vertex,
      x: CANVAS_PADDING + CELL_WIDTH / 2 + (index % columns) * CELL_WIDTH,
      y: CANVAS_PADDING + CELL_HEIGHT / 2 + Math.floor(index / columns) * CELL_HEIGHT,
    })),
  };
}

function relationCopy(relation: MemoryNetwork["edges"][number]["relation"]): string {
  return relation === "MERGED_INTO" ? "Merged into" : "Accepted from";
}

export function MemoryNetworkGraph({
  network,
  advanced,
}: {
  network: MemoryNetwork;
  advanced: boolean;
}) {
  const markerId = `memory-network-arrow-${useId().replaceAll(":", "")}`;
  const vertices = buildVertices(network);
  const layout = layoutVertices(vertices);
  const pointById = new Map(layout.points.map((point) => [point.id, point]));

  return (
    <section className={styles.root} aria-label="Сеть принятой памяти">
      <div className={styles.summary}>
        <strong>{network.nodes.length} canonical memories</strong>
        <span>{network.edges.length} provenance links</span>
      </div>
      {layout.points.length === 0 ? (
        <p className={styles.empty}>Network пуст.</p>
      ) : (
        <>
          <div className={styles.canvas}>
            <svg
              aria-label={`Memory Network: ${network.nodes.length} canonical memories, ${network.edges.length} provenance links`}
              className={styles.svg}
              data-testid="memory-network-graph"
              height={layout.height}
              role="img"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
            >
              <title>Canonical Memory Network with provenance links</title>
              <defs>
                <marker
                  id={markerId}
                  markerHeight="8"
                  markerWidth="8"
                  orient="auto"
                  refX="7"
                  refY="4"
                  viewBox="0 0 8 8"
                >
                  <path className={styles.arrow} d="M0 0L8 4L0 8Z" />
                </marker>
              </defs>
              <g>
                {network.edges.map((edge) => {
                  const source = pointById.get(edge.sourceContextItemId);
                  const target = pointById.get(edge.targetContextItemId);
                  if (!source || !target) return null;
                  return (
                    <line
                      className={`${styles.edge} ${
                        edge.relation === "MERGED_INTO" ? styles.edgeMerged : styles.edgeAccepted
                      }`}
                      data-memory-edge="true"
                      data-relation={edge.relation}
                      key={edgeKey(edge)}
                      markerEnd={`url(#${markerId})`}
                      x1={source.x}
                      x2={target.x}
                      y1={source.y}
                      y2={target.y}
                    />
                  );
                })}
              </g>
              <g>
                {layout.points.map((point) => (
                  <g
                    data-memory-kind={point.kind.toLowerCase()}
                    key={point.id}
                    transform={`translate(${point.x} ${point.y})`}
                  >
                    <circle
                      className={
                        point.kind === "MEMORY" ? styles.memoryCircle : styles.referenceCircle
                      }
                      r={point.kind === "MEMORY" ? 28 : 12}
                    />
                    <text className={styles.nodeLabel} textAnchor="middle" y="44">
                      {compactLabel(point.content)}
                    </text>
                    {point.importance !== null ? (
                      <text className={styles.nodeMeta} textAnchor="middle" y="60">
                        importance {point.importance.toFixed(2)}
                      </text>
                    ) : null}
                  </g>
                ))}
              </g>
            </svg>
          </div>
          <div className={styles.legend} aria-label="Легенда Memory Network" role="group">
            <span>
              <i className={styles.memoryKey} aria-hidden="true" /> Canonical memory
            </span>
            <span>
              <i className={styles.referenceKey} aria-hidden="true" /> Provenance context
            </span>
            <span>
              <i className={styles.acceptedKey} aria-hidden="true" /> Accepted from
            </span>
            <span>
              <i className={styles.mergedKey} aria-hidden="true" /> Merged into
            </span>
          </div>
          <ul className="visually-hidden">
            {network.nodes.map((node) => (
              <li key={node.contextItemId}>Memory: {node.content}</li>
            ))}
            {network.edges.map((edge) => (
              <li key={`${edgeKey(edge)}:accessible`}>
                {relationCopy(edge.relation)}: {edge.sourceContextItemId} →{" "}
                {edge.targetContextItemId}
              </li>
            ))}
          </ul>
          {advanced ? (
            <div className={styles.advanced}>
              <section aria-labelledby="memory-network-node-details">
                <h3 id="memory-network-node-details">Canonical nodes</h3>
                <ul>
                  {network.nodes.map((node) => (
                    <li key={node.contextItemId}>
                      <strong>{node.content}</strong>
                      <code>{node.contextItemId}</code>
                      <span>Source {node.sourceContextItemId}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-labelledby="memory-network-edge-details">
                <h3 id="memory-network-edge-details">Provenance edges</h3>
                <ul>
                  {network.edges.map((edge) => (
                    <li key={`${edgeKey(edge)}:advanced`}>
                      <strong>{relationCopy(edge.relation)}</strong>
                      <code>{edge.sourceContextItemId}</code>
                      <span aria-hidden="true">→</span>
                      <code>{edge.targetContextItemId}</code>
                      <small>{edge.decisionId}</small>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
