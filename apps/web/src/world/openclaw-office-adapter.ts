import type { AgentProjectionCore, WorldView } from "@agent-world/read-model";

/**
 * Presentation boundary adapted from the SVG office composition and position
 * allocation patterns in WW-AI-Lab/openclaw-office at
 * def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6 (MIT). No upstream Gateway,
 * session identity, Zustand store, persistence or simulation crosses this file.
 */

export type OfficeZone = "COMMONS" | "FOCUS" | "COLLABORATION" | "REVIEW_OPS";
export type OfficeVisualStatus =
  | "IDLE"
  | "QUEUED"
  | "WORKING"
  | "REVIEWING"
  | "BLOCKED"
  | "ERROR"
  | "OFFLINE";

export type OfficeSkinZone = {
  id: OfficeZone;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OfficeSkin = {
  id: string;
  width: number;
  height: number;
  zones: readonly OfficeSkinZone[];
};

export const DEFAULT_OFFICE_SKIN: OfficeSkin = {
  id: "openclaw-office-open-floor-v1",
  width: 1_200,
  height: 700,
  zones: [
    { id: "COMMONS", label: "Commons", x: 60, y: 70, width: 250, height: 560 },
    { id: "FOCUS", label: "Focus", x: 340, y: 70, width: 420, height: 560 },
    { id: "COLLABORATION", label: "Collaboration", x: 790, y: 70, width: 170, height: 560 },
    { id: "REVIEW_OPS", label: "Review / Ops", x: 990, y: 70, width: 150, height: 560 },
  ],
};

export type OfficePresentationAgent = {
  agentId: AgentProjectionCore["agentId"];
  displayName: string;
  role: string;
  isEnabled: boolean;
  visualStatus: OfficeVisualStatus;
  statusLabel: string;
  zone: OfficeZone;
  x: number;
  y: number;
  avatarSeed: string;
  currentTask?: AgentProjectionCore["currentTask"];
};

export type OfficePresentationModel = {
  schemaVersion: 1;
  skinId: string;
  width: number;
  height: number;
  source: WorldView["source"];
  cursor: WorldView["cursor"];
  zones: readonly OfficeSkinZone[];
  agents: OfficePresentationAgent[];
};

const STATUS_PRESENTATION: Record<
  AgentProjectionCore["status"],
  { visualStatus: OfficeVisualStatus; zone: OfficeZone; label: string }
> = {
  IDLE: { visualStatus: "IDLE", zone: "COMMONS", label: "Свободен" },
  QUEUED: { visualStatus: "QUEUED", zone: "FOCUS", label: "В очереди" },
  RUNNING: { visualStatus: "WORKING", zone: "FOCUS", label: "Работает" },
  WAITING_APPROVAL: {
    visualStatus: "REVIEWING",
    zone: "REVIEW_OPS",
    label: "Ждёт решения",
  },
  BLOCKED: { visualStatus: "BLOCKED", zone: "REVIEW_OPS", label: "Заблокирован" },
  FAILED: { visualStatus: "ERROR", zone: "REVIEW_OPS", label: "Ошибка" },
  OFFLINE: { visualStatus: "OFFLINE", zone: "COMMONS", label: "Не в сети" },
};

function validateSkin(skin: OfficeSkin): Map<OfficeZone, OfficeSkinZone> {
  if (!skin.id.trim() || skin.width <= 0 || skin.height <= 0) {
    throw new Error("Office skin requires a stable ID and positive dimensions");
  }
  const zones = new Map(skin.zones.map((zone) => [zone.id, zone]));
  if (zones.size !== 4 || skin.zones.length !== 4) {
    throw new Error("Office skin must define each of the four compact zones exactly once");
  }
  for (const zone of skin.zones) {
    if (zone.width <= 0 || zone.height <= 0 || zone.x < 0 || zone.y < 0) {
      throw new Error(`Office skin zone has invalid geometry: ${zone.id}`);
    }
    if (zone.x + zone.width > skin.width || zone.y + zone.height > skin.height) {
      throw new Error(`Office skin zone exceeds the map: ${zone.id}`);
    }
  }
  return zones;
}

function positionsForZone(zone: OfficeSkinZone, count: number): Array<{ x: number; y: number }> {
  if (count === 0) return [];
  const padding = Math.min(44, zone.width * 0.16, zone.height * 0.14);
  const usableWidth = Math.max(1, zone.width - padding * 2);
  const usableHeight = Math.max(1, zone.height - padding * 2);
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * usableWidth) / usableHeight)));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => ({
    x: zone.x + padding + (usableWidth * ((index % columns) + 1)) / (columns + 1),
    y: zone.y + padding + (usableHeight * (Math.floor(index / columns) + 1)) / (rows + 1),
  }));
}

export function createOfficePresentation(
  world: WorldView,
  skin: OfficeSkin,
): OfficePresentationModel {
  const zoneById = validateSkin(skin);
  const canonicalIds = new Set<string>();
  for (const agent of world.agents) {
    if (canonicalIds.has(agent.core.agentId)) {
      throw new Error(`Duplicate canonical Agent: ${agent.core.agentId}`);
    }
    canonicalIds.add(agent.core.agentId);
  }

  const sorted = [...world.agents].sort((left, right) =>
    left.core.agentId.localeCompare(right.core.agentId),
  );
  const grouped = new Map<OfficeZone, typeof sorted>();
  for (const agent of sorted) {
    const zone = STATUS_PRESENTATION[agent.core.status].zone;
    grouped.set(zone, [...(grouped.get(zone) ?? []), agent]);
  }

  const agents: OfficePresentationAgent[] = [];
  for (const zone of skin.zones) {
    const zoneAgents = grouped.get(zone.id) ?? [];
    const validatedZone = zoneById.get(zone.id);
    if (!validatedZone) throw new Error(`Office skin is missing zone: ${zone.id}`);
    const positions = positionsForZone(validatedZone, zoneAgents.length);
    zoneAgents.forEach((agent, index) => {
      const presentation = STATUS_PRESENTATION[agent.core.status];
      const position = positions[index];
      if (!position) throw new Error(`Office position allocation failed: ${agent.core.agentId}`);
      agents.push({
        agentId: agent.core.agentId,
        displayName: agent.core.displayName,
        role: agent.core.role,
        isEnabled: agent.core.isEnabled,
        visualStatus: presentation.visualStatus,
        statusLabel: presentation.label,
        zone: presentation.zone,
        x: position.x,
        y: position.y,
        avatarSeed: agent.core.agentId,
        ...(agent.core.currentTask ? { currentTask: agent.core.currentTask } : {}),
      });
    });
  }

  return {
    schemaVersion: 1,
    skinId: skin.id,
    width: skin.width,
    height: skin.height,
    source: world.source,
    cursor: world.cursor,
    zones: skin.zones,
    agents: agents.sort((left, right) => left.agentId.localeCompare(right.agentId)),
  };
}
