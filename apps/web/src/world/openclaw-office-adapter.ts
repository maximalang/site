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
export type OfficeActionCue = "NONE" | "WORK" | "REVIEW";
export type OfficeSkinTheme = "OPENCLAW_OFFICE" | "SPACE_STATION" | "CYBER_AI_LAB" | "MINIMAL_GRID";

export type OfficeSkinZone = {
  id: OfficeZone;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OfficeSkinPalette = {
  floor: string;
  grid: string;
  accent: string;
  zones: Readonly<Record<OfficeZone, string>>;
};

export type OfficeSkin = {
  id: string;
  label: string;
  theme: OfficeSkinTheme;
  width: number;
  height: number;
  zones: readonly OfficeSkinZone[];
  palette: OfficeSkinPalette;
};

export const DEFAULT_OFFICE_SKIN: OfficeSkin = {
  id: "openclaw-office-open-floor-v1",
  label: "OpenClaw Office",
  theme: "OPENCLAW_OFFICE",
  width: 1_200,
  height: 700,
  zones: [
    { id: "COMMONS", label: "Общая зона", x: 60, y: 70, width: 250, height: 560 },
    { id: "FOCUS", label: "Фокус", x: 340, y: 70, width: 420, height: 560 },
    { id: "COLLABORATION", label: "Совместная работа", x: 790, y: 70, width: 170, height: 560 },
    { id: "REVIEW_OPS", label: "Проверка / Операции", x: 990, y: 70, width: 150, height: 560 },
  ],
  palette: {
    floor: "#1c2a26",
    grid: "#d9e5d8",
    accent: "#75e6c6",
    zones: {
      COMMONS: "#2b3b35",
      FOCUS: "#263934",
      COLLABORATION: "#303a32",
      REVIEW_OPS: "#3b332d",
    },
  },
};

export const SPACE_STATION_SKIN: OfficeSkin = {
  id: "space-station-v1",
  label: "Space Station",
  theme: "SPACE_STATION",
  width: 1_200,
  height: 700,
  zones: [
    { id: "COMMONS", label: "Жилой модуль", x: 60, y: 70, width: 240, height: 250 },
    { id: "COLLABORATION", label: "Связь", x: 60, y: 350, width: 240, height: 280 },
    { id: "FOCUS", label: "Командный мостик", x: 330, y: 70, width: 520, height: 560 },
    { id: "REVIEW_OPS", label: "Центр управления", x: 880, y: 70, width: 260, height: 560 },
  ],
  palette: {
    floor: "#101827",
    grid: "#b9d8ff",
    accent: "#7dd3fc",
    zones: {
      COMMONS: "#17233a",
      FOCUS: "#142746",
      COLLABORATION: "#1d2d4c",
      REVIEW_OPS: "#2c2345",
    },
  },
};

export const CYBER_AI_LAB_SKIN: OfficeSkin = {
  id: "cyber-ai-lab-v1",
  label: "Cyber / AI Lab",
  theme: "CYBER_AI_LAB",
  width: 1_200,
  height: 700,
  zones: [
    { id: "COMMONS", label: "Нейрозона", x: 60, y: 70, width: 260, height: 560 },
    { id: "FOCUS", label: "Вычисления", x: 350, y: 70, width: 380, height: 560 },
    { id: "COLLABORATION", label: "Связь", x: 760, y: 70, width: 380, height: 270 },
    { id: "REVIEW_OPS", label: "Контроль", x: 760, y: 370, width: 380, height: 260 },
  ],
  palette: {
    floor: "#11131c",
    grid: "#a7f3d0",
    accent: "#34d399",
    zones: {
      COMMONS: "#18231f",
      FOCUS: "#112b27",
      COLLABORATION: "#1b2033",
      REVIEW_OPS: "#2a1f31",
    },
  },
};

export const MINIMAL_GRID_SKIN: OfficeSkin = {
  id: "minimal-grid-v1",
  label: "Minimal Grid",
  theme: "MINIMAL_GRID",
  width: 1_200,
  height: 700,
  zones: [
    { id: "COMMONS", label: "Свободны", x: 60, y: 70, width: 240, height: 560 },
    { id: "FOCUS", label: "Работа", x: 340, y: 70, width: 240, height: 560 },
    { id: "COLLABORATION", label: "Передача", x: 620, y: 70, width: 240, height: 560 },
    { id: "REVIEW_OPS", label: "Проверка", x: 900, y: 70, width: 240, height: 560 },
  ],
  palette: {
    floor: "#151719",
    grid: "#d1d5db",
    accent: "#e5e7eb",
    zones: {
      COMMONS: "#202326",
      FOCUS: "#24282b",
      COLLABORATION: "#202326",
      REVIEW_OPS: "#292629",
    },
  },
};

export const OFFICE_SKINS = [
  DEFAULT_OFFICE_SKIN,
  SPACE_STATION_SKIN,
  CYBER_AI_LAB_SKIN,
  MINIMAL_GRID_SKIN,
] as const;

const OFFICE_SKIN_BY_ID = new Map(OFFICE_SKINS.map((skin) => [skin.id, skin]));

export function getOfficeSkin(skinId: string | undefined): OfficeSkin | undefined {
  if (!skinId) return undefined;
  return OFFICE_SKIN_BY_ID.get(skinId);
}

export function resolveOfficeSkin(input: {
  userPreferenceId?: string | null;
  projectSkinId?: string | null;
  systemSkinId?: string | null;
}): OfficeSkin {
  return (
    getOfficeSkin(input.userPreferenceId ?? undefined) ??
    getOfficeSkin(input.projectSkinId ?? undefined) ??
    getOfficeSkin(input.systemSkinId ?? undefined) ??
    DEFAULT_OFFICE_SKIN
  );
}

export type OfficePresentationAgent = {
  agentId: AgentProjectionCore["agentId"];
  displayName: string;
  role: string;
  isEnabled: boolean;
  visualStatus: OfficeVisualStatus;
  actionCue: OfficeActionCue;
  statusLabel: string;
  zone: OfficeZone;
  x: number;
  y: number;
  avatarSeed: string;
  currentTask?: AgentProjectionCore["currentTask"];
};

export type OfficePresentationHandoff = {
  id: WorldView["handoffs"][number]["id"];
  occurredAt: string;
  fromDisplayName: string;
  toDisplayName: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
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
  handoffs: OfficePresentationHandoff[];
};

const MAX_VISIBLE_HANDOFFS = 3;

const STATUS_PRESENTATION: Record<
  AgentProjectionCore["status"],
  {
    visualStatus: OfficeVisualStatus;
    actionCue: OfficeActionCue;
    zone: OfficeZone;
    label: string;
  }
> = {
  IDLE: { visualStatus: "IDLE", actionCue: "NONE", zone: "COMMONS", label: "Свободен" },
  QUEUED: { visualStatus: "QUEUED", actionCue: "NONE", zone: "FOCUS", label: "В очереди" },
  RUNNING: { visualStatus: "WORKING", actionCue: "WORK", zone: "FOCUS", label: "Выполняет" },
  WAITING_APPROVAL: {
    visualStatus: "REVIEWING",
    actionCue: "REVIEW",
    zone: "REVIEW_OPS",
    label: "Ждёт подтверждения",
  },
  BLOCKED: {
    visualStatus: "BLOCKED",
    actionCue: "NONE",
    zone: "REVIEW_OPS",
    label: "Заблокирован",
  },
  FAILED: { visualStatus: "ERROR", actionCue: "NONE", zone: "REVIEW_OPS", label: "Ошибка" },
  OFFLINE: {
    visualStatus: "OFFLINE",
    actionCue: "NONE",
    zone: "COMMONS",
    label: "Не в сети",
  },
};

function validateSkin(skin: OfficeSkin): Map<OfficeZone, OfficeSkinZone> {
  if (!skin.id.trim() || !skin.label.trim() || skin.width <= 0 || skin.height <= 0) {
    throw new Error("Office skin requires stable identity and positive dimensions");
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
        actionCue: presentation.actionCue,
        statusLabel: presentation.label,
        zone: presentation.zone,
        x: position.x,
        y: position.y,
        avatarSeed: agent.core.agentId,
        ...(agent.core.currentTask ? { currentTask: agent.core.currentTask } : {}),
      });
    });
  }

  const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
  const handoffs = world.handoffs
    .slice(-MAX_VISIBLE_HANDOFFS)
    .map((handoff): OfficePresentationHandoff => {
      const from = agentById.get(handoff.fromAgentId);
      const to = agentById.get(handoff.toAgentId);
      if (!from || !to) {
        throw new Error(`Handoff references an Agent outside the office: ${handoff.id}`);
      }
      return {
        id: handoff.id,
        occurredAt: handoff.occurredAt,
        fromDisplayName: from.displayName,
        toDisplayName: to.displayName,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      };
    });

  return {
    schemaVersion: 1,
    skinId: skin.id,
    width: skin.width,
    height: skin.height,
    source: world.source,
    cursor: world.cursor,
    zones: skin.zones,
    agents: agents.sort((left, right) => left.agentId.localeCompare(right.agentId)),
    handoffs,
  };
}
