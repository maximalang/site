import type { AgentProjectionCore, WorldHandoff } from "@agent-world/read-model";

export type WorldPoint = { x: number; y: number };
export type PresentationZone = "COMMONS" | "WORK" | "REVIEW" | "OPERATIONS" | "COLLABORATION";
export type SpriteIdentity = { variant: number; coat: string; accent: string; hair: string };

export const WORLD_SIZE = { width: 1536, height: 960 } as const;
export const COLLABORATION_POINT: WorldPoint = { x: 786, y: 492 };
const ZONE_CENTERS = {
  COMMONS: { x: 430, y: 690 },
  WORK: { x: 410, y: 300 },
  REVIEW: { x: 1090, y: 300 },
  OPERATIONS: { x: 1160, y: 690 },
} satisfies Record<Exclude<PresentationZone, "COLLABORATION">, WorldPoint>;
const PALETTES = [
  ["#4f7dff", "#ffd166", "#3b2d2a"], ["#d15f8f", "#91e3c4", "#4a3027"],
  ["#805ad5", "#f6ad55", "#2d3748"], ["#2b8a6e", "#f2c14e", "#54352b"],
  ["#cb5c46", "#8ecae6", "#302b27"], ["#446f8a", "#e9c46a", "#6b4226"],
] as const;

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function statusTargetZone(status: AgentProjectionCore["status"]): PresentationZone {
  switch (status) {
    case "RUNNING": case "QUEUED": return "WORK";
    case "WAITING_APPROVAL": return "REVIEW";
    case "BLOCKED": case "FAILED": return "OPERATIONS";
    case "IDLE": case "OFFLINE": return "COMMONS";
  }
}

export function spriteIdentity(agentId: string): SpriteIdentity {
  const variant = hashText(agentId) % PALETTES.length;
  const palette = PALETTES[variant] ?? PALETTES[0];
  return { variant, coat: palette[0], accent: palette[1], hair: palette[2] };
}

export function statusVisual(status: AgentProjectionCore["status"]): {
  state: "idle" | "working" | "waiting" | "blocked" | "offline"; opacity: number; pulse: boolean;
} {
  switch (status) {
    case "RUNNING": case "QUEUED": return { state: "working", opacity: 1, pulse: status === "RUNNING" };
    case "WAITING_APPROVAL": return { state: "waiting", opacity: 1, pulse: true };
    case "BLOCKED": case "FAILED": return { state: "blocked", opacity: 1, pulse: true };
    case "OFFLINE": return { state: "offline", opacity: 0.46, pulse: false };
    case "IDLE": return { state: "idle", opacity: 1, pulse: false };
  }
}

export function targetForAgent(agent: AgentProjectionCore, index: number, replayHandoff?: WorldHandoff): WorldPoint {
  if (replayHandoff && (replayHandoff.fromAgentId === agent.agentId || replayHandoff.toAgentId === agent.agentId)) {
    const side = replayHandoff.fromAgentId === agent.agentId ? -1 : 1;
    return { x: COLLABORATION_POINT.x + side * 42, y: COLLABORATION_POINT.y + 14 };
  }
  const center = ZONE_CENTERS[statusTargetZone(agent.status)];
  const hash = hashText(agent.agentId);
  const column = (hash + index * 3) % 5;
  const row = ((hash >>> 5) + index * 2) % 4;
  return { x: center.x + (column - 2) * 54, y: center.y + (row - 1.5) * 44 };
}

export function advancePosition(current: WorldPoint, target: WorldPoint, deltaMs: number, reducedMotion: boolean): { point: WorldPoint; moving: boolean } {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const distance = Math.hypot(dx, dy);
  if (reducedMotion || distance <= 1.2) return { point: { ...target }, moving: false };
  const step = Math.min(distance, Math.max(0, deltaMs) * 0.16);
  return { point: { x: current.x + (dx / Math.max(distance, 1)) * step, y: current.y + (dy / Math.max(distance, 1)) * step }, moving: true };
}

export function clampZoom(value: number): number { return Math.min(2.4, Math.max(0.55, value)); }
export function clampCamera(point: WorldPoint, zoom: number, viewport: WorldPoint): WorldPoint {
  const halfWidth = viewport.x / (2 * zoom);
  const halfHeight = viewport.y / (2 * zoom);
  const minX = Math.min(halfWidth, WORLD_SIZE.width / 2);
  const maxX = Math.max(WORLD_SIZE.width - halfWidth, WORLD_SIZE.width / 2);
  const minY = Math.min(halfHeight, WORLD_SIZE.height / 2);
  const maxY = Math.max(WORLD_SIZE.height - halfHeight, WORLD_SIZE.height / 2);
  return { x: Math.min(maxX, Math.max(minX, point.x)), y: Math.min(maxY, Math.max(minY, point.y)) };
}
export function latestHandoffForAgent(handoffs: WorldHandoff[], agentId: string): WorldHandoff | undefined {
  return [...handoffs].reverse().find((handoff) => handoff.fromAgentId === agentId || handoff.toAgentId === agentId);
}
