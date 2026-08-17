import type { MemoryNetwork } from "@agent-world/domain";
import { useEffect, useId, useRef, useState } from "react";
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

const DEFAULT_CANVAS_WIDTH = 640;
const MIN_CANVAS_WIDTH = 280;
const MIN_CELL_WIDTH = 160;
const CELL_HEIGHT = 124;
const CANVAS_PADDING = 40;
const LABEL_LINE_LENGTH = 20;
const LABEL_MAX_LINES = 2;

function clipLabelLine(value: string): string {
  return value.length <= LABEL_LINE_LENGTH
    ? value
    : `${value.slice(0, LABEL_LINE_LENGTH - 1).trimEnd()}…`;
}

function compactLabelLines(value: string): string[] {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= LABEL_LINE_LENGTH) return [normalized];

  const lines: string[] = [];
  let current = "";
  for (const word of normalized.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= LABEL_LINE_LENGTH) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  if (lines.length <= LABEL_MAX_LINES) return lines.map(clipLabelLine);
  const first = clipLabelLine(lines[0] ?? normalized);
  const remainder = lines.slice(1).join(" ");
  return [first, clipLabelLine(remainder)];
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

function layoutVertices(
  vertices: NetworkVertex[],
  availableWidth = DEFAULT_CANVAS_WIDTH,
): {
  points: NetworkPoint[];
  width: number;
  height: number;
} {
  const width = Math.max(MIN_CANVAS_WIDTH, Math.floor(availableWidth));
  if (vertices.length === 0) return { points: [], width, height: 280 };

  const naturalColumns = Math.max(1, Math.ceil(Math.sqrt(vertices.length * 1.35)));
  const maxColumns = Math.max(
    1,
    Math.floor(Math.max(MIN_CELL_WIDTH, width - CANVAS_PADDING * 2) / MIN_CELL_WIDTH),
  );
  const columns = Math.min(naturalColumns, maxColumns);
  const rows = Math.ceil(vertices.length / columns);
  const innerWidth = Math.max(MIN_CELL_WIDTH, width - CANVAS_PADDING * 2);
  const cellWidth = innerWidth / columns;
  const height = Math.max(280, CANVAS_PADDING * 2 + rows * CELL_HEIGHT);

  return {
    width,
    height,
    points: vertices.map((vertex, index) => ({
      ...vertex,
      x: CANVAS_PADDING + cellWidth * ((index % columns) + 0.5),
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
  const canvasRef = useRef<HTMLElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);
  const vertices = buildVertices(network);
  const layout = layoutVertices(vertices, canvasWidth);
  const pointById = new Map(layout.points.map((point) => [point.id, point]));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateWidth = () => {
      const measuredWidth = Math.floor(canvas.clientWidth);
      if (measuredWidth <= 0) return;
      setCanvasWidth((current) => (current === measuredWidth ? current : measuredWidth));
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // biome-ignore-start lint/a11y/noNoninteractiveTabindex: WCAG requires the scrollable graph region to be keyboard-focusable.
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
          <section
            aria-label="Прокручиваемая схема Memory Network"
            className={styles.canvas}
            ref={canvasRef}
            tabIndex={0}
          >
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
                {layout.points.map((point) => {
                  const labelLines = compactLabelLines(point.content);
                  return (
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
                        <tspan x="0">{labelLines[0]}</tspan>
                        {labelLines[1] ? (
                          <tspan dy="14" x="0">
                            {labelLines[1]}
                          </tspan>
                        ) : null}
                      </text>
                      {point.importance !== null ? (
                        <text
                          className={styles.nodeMeta}
                          textAnchor="middle"
                          y={labelLines.length > 1 ? "76" : "60"}
                        >
                          importance {point.importance.toFixed(2)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          </section>
          <section className={styles.legend} aria-label="Легенда Memory Network">
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
          </section>
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
  // biome-ignore-end lint/a11y/noNoninteractiveTabindex: WCAG requires the scrollable graph region to be keyboard-focusable.
}
