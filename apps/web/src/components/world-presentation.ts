import type { AgentProjectionCore, WorldHandoff } from "@agent-world/read-model";

export type WorldPoint = { x: number; y: number };
export type WorldCamera = WorldPoint & { zoom: number };
export type PresentationZone = "COMMONS" | "WORK" | "REVIEW" | "OPERATIONS" | "COLLABORATION";
export type SpriteIdentity = { variant: number; coat: string; accent: string; hair: string };

export const WORLD_SIZE = { width: 1536, height: 960 } as const;
export const COLLABORATION_POINT: WorldPoint = { x: 786, y: 492 };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.4;
const WORLD_FIT_PADDING = 20;
const AGENT_FIT_PADDING = 92;
const AGENT_CLUSTER_MIN_SIZE = { width: 520, height: 360 } as const;
const COMPACT_VIEWPORT_MAX_WIDTH = 720;
const COMPACT_AGENT_FIT_PADDING = 32;
const COMPACT_AGENT_CLUSTER_MIN_SIZE = { width: 280, height: 320 } as const;
const ZONE_CENTERS = {
  COMMONS: { x: 430, y: 690 },
  WORK: { x: 410, y: 300 },
  REVIEW: { x: 1090, y: 300 },
  OPERATIONS: { x: 1160, y: 690 },
} satisfies Record<Exclude<PresentationZone, "COLLABORATION">, WorldPoint>;
const PALETTES = [
  ["#4f7dff", "#ffd166", "#3b2d2a"],
  ["#d15f8f", "#91e3c4", "#4a3027"],
  ["#805ad5", "#f6ad55", "#2d3748"],
  ["#2b8a6e", "#f2c14e", "#54352b"],
  ["#cb5c46", "#8ecae6", "#302b27"],
  ["#446f8a", "#e9c46a", "#6b4226"],
] as const;

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fitZoom(
  content: { width: number; height: number },
  viewport: WorldPoint,
  padding: number,
) {
  const availableWidth = Math.max(1, viewport.x - padding * 2);
  const availableHeight = Math.max(1, viewport.y - padding * 2);
  return Math.min(availableWidth / content.width, availableHeight / content.height);
}

function isActiveForInitialCamera(status: AgentProjectionCore["status"]): boolean {
  return status !== "IDLE" && status !== "OFFLINE";
}

export function statusTargetZone(
  status: AgentProjectionCore["status"],
): Exclude<PresentationZone, "COLLABORATION"> {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return "WORK";
    case "WAITING_APPROVAL":
      return "REVIEW";
    case "BLOCKED":
    case "FAILED":
      return "OPERATIONS";
    case "IDLE":
    case "OFFLINE":
      return "COMMONS";
  }
}

export function spriteIdentity(agentId: string): SpriteIdentity {
  const hash = hashText(agentId);
  const variant = ((hash ^ (hash >>> 16)) >>> 0) % PALETTES.length;
  const palette = PALETTES[variant] ?? PALETTES[0];
  return { variant, coat: palette[0], accent: palette[1], hair: palette[2] };
}

export function statusVisual(status: AgentProjectionCore["status"]): {
  state: "idle" | "working" | "waiting" | "blocked" | "offline";
  opacity: number;
  pulse: boolean;
} {
  switch (status) {
    case "RUNNING":
    case "QUEUED":
      return { state: "working", opacity: 1, pulse: status === "RUNNING" };
    case "WAITING_APPROVAL":
      return { state: "waiting", opacity: 1, pulse: true };
    case "BLOCKED":
    case "FAILED":
      return { state: "blocked", opacity: 1, pulse: true };
    case "OFFLINE":
      return { state: "offline", opacity: 0.46, pulse: false };
    case "IDLE":
      return { state: "idle", opacity: 1, pulse: false };
  }
}

export function targetForAgent(
  agent: AgentProjectionCore,
  index: number,
  replayHandoff?: WorldHandoff,
): WorldPoint {
  if (
    replayHandoff &&
    (replayHandoff.fromAgentId === agent.agentId || replayHandoff.toAgentId === agent.agentId)
  ) {
    const side = replayHandoff.fromAgentId === agent.agentId ? -1 : 1;
    return { x: COLLABORATION_POINT.x + side * 42, y: COLLABORATION_POINT.y + 14 };
  }
  const center = ZONE_CENTERS[statusTargetZone(agent.status)];
  const hash = hashText(agent.agentId);
  const column = (hash + index * 3) % 5;
  const row = ((hash >>> 5) + index * 2) % 4;
  return { x: center.x + (column - 2) * 54, y: center.y + (row - 1.5) * 44 };
}

export function advancePosition(
  current: WorldPoint,
  target: WorldPoint,
  deltaMs: number,
  reducedMotion: boolean,
): { point: WorldPoint; moving: boolean } {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const distance = Math.hypot(dx, dy);
  if (reducedMotion || distance <= 1.2) return { point: { ...target }, moving: false };
  const step = Math.min(distance, Math.max(0, deltaMs) * 0.16);
  return {
    point: {
      x: current.x + (dx / Math.max(distance, 1)) * step,
      y: current.y + (dy / Math.max(distance, 1)) * step,
    },
    moving: true,
  };
}

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function clampCamera(point: WorldPoint, zoom: number, viewport: WorldPoint): WorldPoint {
  const halfWidth = viewport.x / (2 * zoom);
  const halfHeight = viewport.y / (2 * zoom);
  const minX = Math.min(halfWidth, WORLD_SIZE.width / 2);
  const maxX = Math.max(WORLD_SIZE.width - halfWidth, WORLD_SIZE.width / 2);
  const minY = Math.min(halfHeight, WORLD_SIZE.height / 2);
  const maxY = Math.max(WORLD_SIZE.height - halfHeight, WORLD_SIZE.height / 2);
  return {
    x: Math.min(maxX, Math.max(minX, point.x)),
    y: Math.min(maxY, Math.max(minY, point.y)),
  };
}

export function fitWorldCamera(viewport: WorldPoint): WorldCamera {
  const zoom = clampZoom(fitZoom(WORLD_SIZE, viewport, WORLD_FIT_PADDING));
  return {
    x: WORLD_SIZE.width / 2,
    y: WORLD_SIZE.height / 2,
    zoom,
  };
}

export function initialCameraForAgents(
  agents: AgentProjectionCore[],
  viewport: WorldPoint,
): WorldCamera {
  if (agents.length === 0) return fitWorldCamera(viewport);

  const indexedAgents = agents.map((agent, index) => ({ agent, index }));
  const compact = viewport.x <= COMPACT_VIEWPORT_MAX_WIDTH;
  const activeAgents = compact
    ? indexedAgents.filter(({ agent }) => isActiveForInitialCamera(agent.status))
    : [];
  const focusAgents = compact && activeAgents.length > 0 ? activeAgents : indexedAgents;
  const targets = focusAgents.map(({ agent, index }) => targetForAgent(agent, index));
  const xs = targets.map((target) => target.x);
  const ys = targets.map((target) => target.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const minimumSize = compact ? COMPACT_AGENT_CLUSTER_MIN_SIZE : AGENT_CLUSTER_MIN_SIZE;
  const content = {
    width: Math.max(minimumSize.width, maxX - minX),
    height: Math.max(minimumSize.height, maxY - minY),
  };
  const padding = compact ? COMPACT_AGENT_FIT_PADDING : AGENT_FIT_PADDING;
  const zoom = clampZoom(Math.min(1.15, fitZoom(content, viewport, padding)));
  const clamped = clampCamera(center, zoom, viewport);
  return { ...clamped, zoom };
}
